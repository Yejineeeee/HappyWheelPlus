"""Build and write the web data contract (segments, graph, pois, courses, cities index)."""
from __future__ import annotations

import bisect
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import networkx as nx

from .config import City
from .elevation import ElevationSource
from .geo import line_length_m, sample_along
from .network import is_span
from .pois import POI_KINDS
from .routing import ALPHA, RouteResult, oriented_coords, route, route_metrics
from .scoring import DEFAULT_WEIGHTS

SURFACE_CLASSES = ("smooth", "paving", "compacted", "cobble", "unpaved", "unknown")
APPROX_SNAP_M = 150.0  # stop farther than this from the routable network -> course is approximate


def _num(x, nd: int = 1):
    if x is None:
        return None
    x = float(x)
    return None if math.isnan(x) or math.isinf(x) else round(x, nd)


def _pt(c) -> list[float]:
    return [round(float(c[0]), 5), round(float(c[1]), 5)]


def route_profile(G, r: RouteResult, node_elev: dict, src: ElevationSource,
                  step_m: float = 25.0) -> list[list]:
    """Rows [dist_m, elev_m|None, grade_pct|None] every step_m along the route.

    Elevation comes from the DEM, except on bridge/tunnel edges where it is linearly
    interpolated between the edge's end-node elevations (the DEM would show the river or
    ground below the deck). grade_pct is the grade_max of the edge the sample lies on."""
    if len(r.coords) < 2 or not r.edges:
        return []
    starts, spans = [], []
    cum = 0.0
    for u, v, k in r.edges:
        d = G[u][v][k]
        length = line_length_m(oriented_coords(G, u, d))
        starts.append(cum)
        spans.append((cum, cum + length, u, v, d))
        cum += length
    pts = sample_along(r.coords, step_m)
    owner = [min(max(bisect.bisect_right(starts, dist + 1e-6) - 1, 0), len(spans) - 1)
             for _, _, dist in pts]
    dem_idx = [i for i, o in enumerate(owner) if not is_span(spans[o][4])]
    dem = src.elevations([(pts[i][0], pts[i][1]) for i in dem_idx])
    elev: list[float | None] = [None] * len(pts)
    for i, e in zip(dem_idx, dem):
        elev[i] = e
    for i, o in enumerate(owner):
        a, b, u, v, d = spans[o]
        if is_span(d):
            ea, eb = node_elev.get(u), node_elev.get(v)
            if ea is not None and eb is not None:
                t = 0.0 if b <= a else min(max((pts[i][2] - a) / (b - a), 0.0), 1.0)
                elev[i] = ea + (eb - ea) * t
    return [[_num(pts[i][2]), _num(elev[i]), _num(spans[o][4].get("grade_max"))]
            for i, o in enumerate(owner)]


def _route_json(G, r: RouteResult, seg_of: dict, toilets, src, node_elev: dict) -> dict:
    m = route_metrics(G, r, toilets)
    for k, v in list(m.items()):
        if isinstance(v, float) or v is None:
            m[k] = _num(v)
    return {
        "coords": [_pt(c) for c in r.coords],
        "seg_ids": [seg_of[e] for e in r.edges],
        "metrics": m,
        "profile": route_profile(G, r, node_elev, src),
    }


def _city_metrics(city: City, G, pois: list[dict]) -> dict:
    total = blocked = surf_known = slope_known = w_score = w_len = 0.0
    mix = dict.fromkeys(SURFACE_CLASSES, 0.0)
    for _, _, d in G.edges(data=True):
        n = float(d["length"])
        total += n
        cls = d.get("surface_class") or "unknown"
        mix[cls if cls in mix else "unknown"] += n
        if d.get("blocked"):
            blocked += n
        if cls != "unknown":
            surf_known += n
        if d.get("grade_max") is not None:
            slope_known += n
        if d.get("score") is not None:
            w_score += n * d["score"]
            w_len += n
    t = total or 1.0
    # graph_from_point / features_from_point cover a square of side 2r (dist_type="bbox")
    area = (2 * city.radius_m) ** 2 / 1e6
    counts = dict.fromkeys(POI_KINDS, 0)
    for p in pois:
        if p["kind"] in counts:
            counts[p["kind"]] += 1
    return {
        "mean_score": _num(w_score / w_len) if w_len else None,
        "blocked_share": round(blocked / t, 4),
        "surface_coverage": round(surf_known / t, 4),
        "slope_coverage": round(slope_known / t, 4),
        "network_km": round(total / 1000, 2),
        "area_km2": round(area, 3),
        "poi_per_km2": {k: round(counts[k] / area, 4) for k in POI_KINDS},
        "surface_mix": {k: round(v / t, 4) for k, v in mix.items()},
        "course_count": len(city.courses),
    }


def build_city_outputs(city: City, G: nx.MultiGraph, pois: list[dict],
                       src: ElevationSource) -> tuple[dict[str, object], dict]:
    """Return a tuple (outputs, metrics): filename -> JSON object, and the per-city
    metrics dict (incl. course_count) to pass to build_cities_index."""
    node_idx = {n: i for i, n in enumerate(G.nodes)}
    nodes = [_pt((G.nodes[n]["x"], G.nodes[n]["y"])) for n in G.nodes]
    elevs = src.elevations([(G.nodes[n]["x"], G.nodes[n]["y"]) for n in G.nodes])
    node_elev = dict(zip(G.nodes, elevs))

    seg_of: dict[tuple, int] = {}
    features, rows = [], []
    for sid, (u, v, k, d) in enumerate(G.edges(keys=True, data=True)):
        seg_of[(u, v, k)] = sid
        seg_of[(v, u, k)] = sid
        coords = [_pt(c) for c in oriented_coords(G, u, d)]  # u -> v, as in graph.json
        features.append({
            "type": "Feature", "id": sid,
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "len": _num(d["length"]),
                "p_slope": _num(d["p_slope"]), "p_surface": _num(d["p_surface"]),
                "p_kerb": _num(d["p_kerb"]), "p_unc": _num(d["p_unc"]),
                "grade_max": _num(d.get("grade_max")),
                "surface_class": d["surface_class"],
                "wc_yes": bool(d["wc_yes"]), "steps": bool(d["steps"]),
                "blocked": bool(d["blocked"]), "score": _num(d.get("score")),
            },
        })
        flags = (1 if d["blocked"] else 0) | (2 if d["steps"] else 0) | (4 if d["wc_yes"] else 0)
        rows.append([node_idx[u], node_idx[v], _num(d["length"]), _num(d["p_slope"]),
                     _num(d["p_surface"]), _num(d["p_kerb"]), _num(d["p_unc"]), flags])

    toilets = [(p["lon"], p["lat"]) for p in pois if p["kind"] == "toilet"]
    courses = []
    for i, c in enumerate(city.courses):
        stops = [(s.lon, s.lat) for s in c.stops]
        short = route(G, stops, "shortest")
        acc = route(G, stops, "accessible")
        sj = _route_json(G, short, seg_of, toilets, src, node_elev) if short.coords else None
        aj = _route_json(G, acc, seg_of, toilets, src, node_elev) if acc.reachable else None
        comparison = None
        if aj is not None and sj is not None:
            comparison = {
                "extra_m": _num(aj["metrics"]["length_m"] - sj["metrics"]["length_m"]),
                "steps_avoided": sj["metrics"]["steps_count"] - aj["metrics"]["steps_count"],
            }
        snap_max = _num(max(short.snap_m)) if short.snap_m else None
        courses.append({
            "index": i, "name": c.name, "time_label": c.time_label,
            "stops": [{"name": s.name, "lon": round(s.lon, 5), "lat": round(s.lat, 5)}
                      for s in c.stops],
            "field": None if c.field is None else {
                "difficulty": c.field.difficulty, "stars": c.field.stars, "note": c.field.note},
            "snap_max_m": snap_max,
            "approximate": snap_max is not None and snap_max > APPROX_SNAP_M,
            "reachable": acc.reachable,
            "blocked_at": None if acc.blocked_at is None else _pt(acc.blocked_at),
            "routes": {"shortest": sj, "accessible": aj},
            "comparison": comparison,
        })

    poi_features = [{
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": _pt((p["lon"], p["lat"]))},
        "properties": {"kind": p["kind"], "name": p.get("name"),
                       "wheelchair": p.get("wheelchair"), "osm_id": p["osm_id"]},
    } for p in pois]

    outputs: dict[str, object] = {
        "segments.geojson": {"type": "FeatureCollection", "features": features},
        "graph.json": {"nodes": nodes, "elev": [_num(e) for e in elevs], "edges": rows},
        "pois.geojson": {"type": "FeatureCollection", "features": poi_features},
        "courses.json": courses,
    }
    return outputs, _city_metrics(city, G, pois)


def write_outputs(out_dir: Path, city_id: str, outputs: dict[str, object]) -> str:
    """Write the city's files; return data_version = first 12 hex chars of the sha256 over
    the written files' bytes, concatenated in file-name order."""
    d = Path(out_dir) / city_id
    d.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    for name in sorted(outputs):
        data = json.dumps(outputs[name], ensure_ascii=False, allow_nan=False,
                          separators=(",", ":")).encode("utf-8")
        (d / name).write_bytes(data)
        digest.update((d / name).read_bytes())
    return digest.hexdigest()[:12]


def build_cities_index(cities: list[City], per_city_metrics: dict[str, dict]) -> dict:
    out = []
    for c in cities:
        if c.id not in per_city_metrics:
            continue
        m = per_city_metrics[c.id]
        out.append({
            "id": c.id, "name_ko": c.name_ko, "country_ko": c.country_ko,
            "center": _pt(c.center), "radius_m": round(c.radius_m, 1),
            "data_version": m["data_version"],
            "metrics": {k: v for k, v in m.items() if k not in ("course_count", "data_version")},
            "course_count": m["course_count"],
        })
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "weights_default": dict(DEFAULT_WEIGHTS),
        "alpha": ALPHA,
        "cities": out,
    }
