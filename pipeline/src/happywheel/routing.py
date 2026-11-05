"""Shortest and accessible routing over an annotated walking graph, plus route metrics."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import networkx as nx
import numpy as np

from .geo import point_line_distance_m, to_local_xy

ALPHA = 3.0
STEEP_GRADE = 6.0
TOILET_RADIUS_M = 300.0


@dataclass
class RouteResult:
    reachable: bool
    edges: list[tuple[int, int, int]] = field(default_factory=list)
    coords: list[tuple[float, float]] = field(default_factory=list)
    blocked_at: tuple[float, float] | None = None
    snap_m: list[float] = field(default_factory=list)  # stop -> snapped node, metres


def main_component_nodes(G: nx.MultiGraph) -> list[int]:
    """Nodes of the largest connected component of the non-blocked edges
    (falls back to every node when no edge is passable)."""
    H = nx.Graph()
    for u, v, d in G.edges(data=True):
        if not d.get("blocked"):
            H.add_edge(u, v)
    if H.number_of_nodes() == 0:
        return list(G.nodes)
    return list(max(nx.connected_components(H), key=len))


def snap_nodes(G: nx.MultiGraph, stops: list[tuple[float, float]]
               ) -> tuple[list[int], list[float]]:
    """Snap every stop to the nearest node in the main accessible component.
    Returns (node ids, snap distances in metres)."""
    ids = main_component_nodes(G)
    if not ids or not stops:
        return [], []
    pts = np.array([(G.nodes[n]["x"], G.nodes[n]["y"]) for n in ids], dtype=float)
    nodes, dists = [], []
    for lon, lat in stops:
        xy = to_local_xy(pts, lat)
        p = to_local_xy([(lon, lat)], lat)[0]
        d2 = ((xy - p) ** 2).sum(axis=1)
        i = int(np.argmin(d2))
        nodes.append(ids[i])
        dists.append(float(np.sqrt(d2[i])))
    return nodes, dists


def _edge_cost(d: dict, mode: str) -> float | None:
    if mode == "shortest":
        return float(d["length"])
    if d.get("blocked"):
        return None
    score = d.get("score")
    score = 0.0 if score is None else score
    return float(d["length"]) * (1 + ALPHA * (100 - score) / 100)


def _best_key(keydict: dict, mode: str) -> tuple[int, float] | None:
    best = None
    for k, d in keydict.items():
        c = _edge_cost(d, mode)
        if c is not None and (best is None or c < best[1]):
            best = (k, c)
    return best


def oriented_coords(G, u, d) -> list[tuple[float, float]]:
    coords = list(d["coords"])
    ux, uy = G.nodes[u]["x"], G.nodes[u]["y"]
    d_first = (coords[0][0] - ux) ** 2 + (coords[0][1] - uy) ** 2
    d_last = (coords[-1][0] - ux) ** 2 + (coords[-1][1] - uy) ** 2
    return coords[::-1] if d_last < d_first else coords


def route(G: nx.MultiGraph, stops: list[tuple[float, float]],
          mode: Literal["shortest", "accessible"]) -> RouteResult:
    def weight(u, v, keydict):
        best = _best_key(keydict, mode)
        return None if best is None else best[1]

    res = RouteResult(reachable=True)
    nodes, res.snap_m = snap_nodes(G, stops)
    if nodes:
        res.coords.append((G.nodes[nodes[0]]["x"], G.nodes[nodes[0]]["y"]))
    for i, (s, t) in enumerate(zip(nodes, nodes[1:])):
        if s == t:
            continue
        try:
            path = nx.shortest_path(G, s, t, weight=weight)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            res.reachable = False
            res.blocked_at = tuple(stops[i])
            return res
        for u, v in zip(path, path[1:]):
            key = _best_key(G[u][v], mode)[0]
            res.edges.append((u, v, key))
            res.coords.extend(oriented_coords(G, u, G[u][v][key])[1:])
    return res


def route_metrics(G: nx.MultiGraph, r: RouteResult,
                  toilets: list[tuple[float, float]]) -> dict:
    ds = [G.edges[e] for e in r.edges]
    grades = [d["grade_max"] for d in ds if d.get("grade_max") is not None]
    scored = [d for d in ds if not d.get("blocked") and d.get("score") is not None]
    w = sum(d["length"] for d in scored)
    mean_score = sum(d["score"] * d["length"] for d in scored) / w if w > 0 else None
    toilets_n = 0
    if r.edges:
        toilets_n = sum(1 for t in toilets
                        if point_line_distance_m(t, r.coords) <= TOILET_RADIUS_M)
    return {
        "length_m": float(sum(d["length"] for d in ds)),
        # only impassable steps count; ramp/wheelchair=yes steps are passable
        "steps_count": sum(1 for d in ds if d.get("steps") and d.get("blocked")),
        "max_grade_pct": max(grades) if grades else None,
        "steep_m": float(sum(d["length"] for d in ds
                             if d.get("grade_max") is not None and d["grade_max"] >= STEEP_GRADE)),
        "cobble_m": float(sum(d["length"] for d in ds if d.get("surface_class") == "cobble")),
        "mean_score": mean_score,
        "toilets_300m": toilets_n,
    }
