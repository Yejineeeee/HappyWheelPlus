"""Build and write the web data contract (segments, graph, pois, courses, cities index)."""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import networkx as nx

from .config import City
from .elevation import ElevationSource, profile
from .routing import ALPHA, RouteResult, route, route_metrics
from .scoring import DEFAULT_WEIGHTS

SURFACE_CLASSES = ("smooth", "paving", "compacted", "cobble", "unpaved", "unknown")
POI_KINDS = ("toilet", "elevator", "bench", "fountain")
APPROX_SNAP_M = 150.0  # stop farther than this from the routable network -> course is approximate


def _num(x, nd: int = 1):
    if x is None:
        return None
    x = float(x)
    return None if math.isnan(x) or math.isinf(x) else round(x, nd)


def _pt(c) -> list[float]:
    return [round(float(c[0]), 5), round(float(c[1]), 5)]


def _route_json(G, r: RouteResult, seg_of: dict, toilets, src) -> dict:
    m = route_metrics(G, r, toilets)
    for k, v in list(m.items()):
        if isinstance(v, float) or v is None:
            m[k] = _num(v)
    prof = profile(r.coords, src, step_m=25.0) if len(r.coords) >= 2 else []
    return {
        "coords": [_pt(c) for c in r.coords],
        "seg_ids": [seg_of[e] for e in r.edges],
        "metrics": m,
        "profile": [[_num(d), _num(e)] for d, e in prof],
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
    area = math.pi * city.radius_m ** 2 / 1e6
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

    seg_of: dict[tuple, int] = {}
    features, rows = [], []
    for sid, (u, v, k, d) in enumerate(G.edges(keys=True, data=True)):
        seg_of[(u, v, k)] = sid
        seg_of[(v, u, k)] = sid
        coords = [_pt(c) for c in d["coords"]]
        features.append({
            "type": "Feature", "id": sid,
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "id": sid, "len": _num(d["length"]),
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
                     _num(d["p_surface"]), _num(d["p_kerb"]), _num(d["p_unc"]), flags, sid])

    toilets = [(p["lon"], p["lat"]) for p in pois if p["kind"] == "toilet"]
    courses = []
    for i, c in enumerate(city.courses):
        stops = [(s.lon, s.lat) for s in c.stops]
        short = route(G, stops, "shortest")
        acc = route(G, stops, "accessible")
        sj = _route_json(G, short, seg_of, toilets, src) if short.coords else None
        aj = _route_json(G, acc, seg_of, toilets, src) if acc.reachable else None
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
        "graph.json": {"nodes": nodes, "edges": rows},
        "pois.geojson": {"type": "FeatureCollection", "features": poi_features},
        "courses.json": courses,
    }
    return outputs, _city_metrics(city, G, pois)


def write_outputs(out_dir: Path, city_id: str, outputs: dict[str, object]) -> None:
    d = Path(out_dir) / city_id
    d.mkdir(parents=True, exist_ok=True)
    for name, obj in outputs.items():
        (d / name).write_text(
            json.dumps(obj, ensure_ascii=False, allow_nan=False, separators=(",", ":")),
            encoding="utf-8")


def build_cities_index(cities: list[City], per_city_metrics: dict[str, dict]) -> dict:
    out = []
    for c in cities:
        if c.id not in per_city_metrics:
            continue
        m = per_city_metrics[c.id]
        out.append({
            "id": c.id, "name_ko": c.name_ko, "country_ko": c.country_ko,
            "center": _pt(c.center), "radius_m": round(c.radius_m, 1),
            "metrics": {k: v for k, v in m.items() if k != "course_count"},
            "course_count": m["course_count"],
        })
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "weights_default": dict(DEFAULT_WEIGHTS),
        "alpha": ALPHA,
        "cities": out,
    }
