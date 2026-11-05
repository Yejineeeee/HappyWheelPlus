"""OSM walking network fetch and per-edge accessibility annotation."""
from __future__ import annotations

import ast
import re
from pathlib import Path

import networkx as nx

from .config import City
from .elevation import ElevationSource, grade_from_samples
from .geo import line_length_m, sample_along
from .scoring import (
    DEFAULT_WEIGHTS, is_blocked, is_steps, kerb_penalty, segment_score,
    slope_penalty, surface_class, surface_penalty, uncertainty_penalty,
)

USEFUL_WAY_TAGS = ["surface", "smoothness", "incline", "wheelchair", "highway",
                   "ramp", "bridge", "tunnel", "width", "name"]
USEFUL_NODE_TAGS = ["kerb", "highway", "crossing"]

STEP_M = 10.0
MIN_RUN_M = 30.0
ELEV_CHUNK = 200_000

_INCLINE_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*%?\s*$")


def fetch_network(city: City, cache_dir: Path) -> nx.MultiGraph:
    import osmnx as ox

    cache_dir = Path(cache_dir)
    path = cache_dir / f"{city.id}_walk.graphml"
    if path.exists():
        return ox.load_graphml(path)
    ox.settings.useful_tags_way = USEFUL_WAY_TAGS
    ox.settings.useful_tags_node = USEFUL_NODE_TAGS
    ox.settings.cache_folder = str(cache_dir / "osmnx")
    lon, lat = city.center
    G = ox.graph_from_point((lat, lon), dist=city.radius_m, network_type="walk",
                            simplify=True, retain_all=False)
    G = ox.convert.to_undirected(G)
    cache_dir.mkdir(parents=True, exist_ok=True)
    ox.save_graphml(G, path)
    return G


def _norm(value):
    """Tag value as str, list[str] or None; undoes graphml's stringified lists."""
    if isinstance(value, str) and value.startswith("["):
        try:
            parsed = ast.literal_eval(value)
            if isinstance(parsed, list):
                return [str(v) for v in parsed]
        except (ValueError, SyntaxError):
            pass
    if value is None or (isinstance(value, float) and value != value):
        return None
    return value


def _values(value) -> list[str]:
    value = _norm(value)
    if value is None:
        return []
    return [value] if isinstance(value, str) else [str(v) for v in value]


def parse_incline(value) -> float | None:
    """Absolute percent from an incline tag ("12%", "-5%", "5"); None for up/down/yes."""
    for v in _values(value):
        m = _INCLINE_RE.match(v)
        if m:
            return abs(float(m.group(1)))
    return None


def _edge_coords(G, u, v, d) -> list[tuple[float, float]]:
    geom = d.get("geometry")
    if geom is not None:
        return [(float(x), float(y)) for x, y in geom.coords]
    return [(float(G.nodes[u]["x"]), float(G.nodes[u]["y"])),
            (float(G.nodes[v]["x"]), float(G.nodes[v]["y"]))]


def annotate(G: nx.MultiGraph, src: ElevationSource) -> None:
    """Add length, coords, grades, penalties and score to every edge (one batched DEM call)."""
    edges = []
    flat: list[tuple[float, float]] = []
    for u, v, d in G.edges(data=True):
        coords = _edge_coords(G, u, v, d)
        d["coords"] = coords
        length = d.get("length")
        d["length"] = float(length) if length is not None else line_length_m(coords)
        incline = parse_incline(d.get("incline"))
        skip_dem = any(x != "no" for x in _values(d.get("bridge")) + _values(d.get("tunnel")))
        samples = None
        if incline is None and not skip_dem:
            samples = sample_along(coords, STEP_M)
            flat.extend((p[0], p[1]) for p in samples)
        edges.append((u, v, d, incline, samples))

    elev: list[float | None] = []
    for i in range(0, len(flat), ELEV_CHUNK):
        elev.extend(src.elevations(flat[i:i + ELEV_CHUNK]))

    pos = 0
    for u, v, d, incline, samples in edges:
        if incline is not None:
            g_mean = g_max = incline
        elif samples is not None:
            e = elev[pos:pos + len(samples)]
            pos += len(samples)
            g_mean, g_max = grade_from_samples(samples, e, MIN_RUN_M)
        else:
            g_mean = g_max = None
        cls = surface_class(_norm(d.get("surface")))
        kerbs = [k for n in (u, v) for k in (_values(G.nodes[n].get("kerb")) or [None])]
        tags = {k: _norm(d.get(k)) for k in ("highway", "ramp", "wheelchair")}
        p = {
            "slope": slope_penalty(g_max),
            "surface": surface_penalty(cls, _norm(d.get("smoothness"))),
            "kerb": kerb_penalty(kerbs),
            "uncertainty": uncertainty_penalty(cls, g_max),
        }
        wc_yes = "yes" in _values(d.get("wheelchair"))
        blocked = is_blocked(tags)
        d.update(
            grade_mean=g_mean, grade_max=g_max, surface_class=cls,
            p_slope=p["slope"], p_surface=p["surface"], p_kerb=p["kerb"],
            p_unc=p["uncertainty"], steps=is_steps(tags), blocked=blocked,
            wc_yes=wc_yes,
            score=None if blocked else segment_score(p, DEFAULT_WEIGHTS, wc_yes),
        )
