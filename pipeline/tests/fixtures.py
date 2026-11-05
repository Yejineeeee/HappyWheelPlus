"""Fake elevation sources shared by tests."""
from __future__ import annotations

from happywheel.geo import to_local_xy


class Plane:
    """Elevation rises eastward at `grade_pct` percent."""

    def __init__(self, grade_pct: float, lat0: float = 48.86, lon0: float = 2.33):
        self.grade = grade_pct / 100.0
        self.lat0 = lat0
        self.x0 = float(to_local_xy([(lon0, lat0)], lat0)[0][0])

    def elevations(self, lonlats):
        if not lonlats:
            return []
        xy = to_local_xy(lonlats, self.lat0)
        return [float((x - self.x0) * self.grade) for x in xy[:, 0]]


class Holes:
    """Returns None everywhere (all=True) or inside lon range [lon_min, lon_max]."""

    def __init__(self, all: bool = False, lon_min: float | None = None,
                 lon_max: float | None = None, base: float = 10.0):
        self.all = all
        self.lon_min = lon_min
        self.lon_max = lon_max
        self.base = base

    def elevations(self, lonlats):
        out = []
        for lon, _ in lonlats:
            hole = self.all or (
                self.lon_min is not None and self.lon_max is not None
                and self.lon_min <= lon <= self.lon_max
            )
            out.append(None if hole else self.base)
        return out


# --- OSM-like graphs (no network) -------------------------------------------
import networkx as nx  # noqa: E402

from happywheel.geo import GEOD  # noqa: E402

GRID_LON0, GRID_LAT0, GRID_STEP_M = 2.33, 48.86, 100.0


def make_grid_graph(tags_by_edge: dict | None = None,
                    node_tags: dict | None = None) -> nx.MultiGraph:
    """3x3 grid, 100 m spacing near Paris. Node id = row * 3 + col (row 0 south, col 0 west).

    Default tagged edges:
      3-4 surface=sett        0-3 highway=steps     1-2 bridge=yes
      4-5 incline=-9%         node 8 kerb=raised (touches edges 5-8, 7-8)
    Edge 0-1 is plain and is what first_edge() returns.
    """
    tags_by_edge = tags_by_edge if tags_by_edge is not None else {
        (3, 4): {"surface": "sett"},
        (0, 3): {"highway": "steps"},
        (1, 2): {"bridge": "yes"},
        (4, 5): {"incline": "-9%"},
    }
    node_tags = node_tags if node_tags is not None else {8: {"kerb": "raised"}}
    G = nx.MultiGraph(crs="epsg:4326")
    for r in range(3):
        row_lon, row_lat, _ = GEOD.fwd(GRID_LON0, GRID_LAT0, 0, r * GRID_STEP_M)
        for c in range(3):
            lon, lat, _ = GEOD.fwd(row_lon, row_lat, 90, c * GRID_STEP_M)
            G.add_node(r * 3 + c, x=lon, y=lat, **node_tags.get(r * 3 + c, {}))
    for r in range(3):
        for c in range(3):
            n = r * 3 + c
            for m in ((n + 1) if c < 2 else None, (n + 3) if r < 2 else None):
                if m is not None:
                    G.add_edge(n, m, **{"length": GRID_STEP_M, "highway": "footway",
                                        **tags_by_edge.get((n, m), {})})
    return G


def first_edge(G: nx.MultiGraph, u: int = 0, v: int = 1) -> dict:
    return G.edges[u, v, 0]
