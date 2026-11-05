import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import pytest
from fixtures import GRID_STEP_M, Plane, make_route_graph, node_lonlat

from happywheel.geo import GEOD, to_local_xy
from happywheel.network import annotate
from happywheel.routing import ALPHA, route, route_metrics, snap_nodes


@pytest.fixture
def env():
    G, n = make_route_graph()
    annotate(G, Plane(0))
    return G, node_lonlat(G, n["A"]), node_lonlat(G, n["C"]), node_lonlat(G, n["D"])


def steps_in(G, r):
    return sum(1 for e in r.edges if G.edges[e]["steps"])


def test_alpha():
    assert ALPHA == 3.0


def test_snap_nodes_nearest(env):
    G, A, C, D = env
    lon, lat, _ = GEOD.fwd(A[0], A[1], 45, 10)
    nodes, dists = snap_nodes(G, [(lon, lat), C])
    assert nodes == [6, 8] and dists[0] == pytest.approx(10, abs=0.5) and dists[1] < 0.5


def test_shortest_uses_steps(env):
    G, A, C, D = env
    r = route(G, [A, C], "shortest")
    assert r.reachable and steps_in(G, r) == 1
    assert r.edges[0][:2] == (6, 7)


def test_accessible_avoids_steps(env):
    G, A, C, D = env
    r = route(G, [A, C], "accessible")
    assert r.reachable and steps_in(G, r) == 0


def test_accessible_longer_but_no_steps(env):
    G, A, C, D = env
    m_s = route_metrics(G, route(G, [A, C], "shortest"), [])
    m_a = route_metrics(G, route(G, [A, C], "accessible"), [])
    assert m_a["length_m"] > m_s["length_m"] and m_a["steps_count"] == 0
    assert m_s["steps_count"] == 1
    assert m_s["length_m"] == pytest.approx(2 * GRID_STEP_M)


def test_island_stop_snaps_to_main_component(env):
    G, A, C, D = env
    nodes, snap = snap_nodes(G, [A, D])
    assert nodes == [6, 8]  # D (steps-only island node 9) -> nearest main node 8
    assert snap[0] == pytest.approx(0.0, abs=1.0)
    assert snap[1] == pytest.approx(GRID_STEP_M, abs=1.0)


def test_shortest_and_accessible_share_snapped_nodes(env):
    G, A, C, D = env
    s = route(G, [A, D], "shortest")
    a = route(G, [A, D], "accessible")
    assert s.reachable and a.reachable
    assert s.coords[0] == a.coords[0] and s.coords[-1] == a.coords[-1]
    assert s.snap_m == a.snap_m
    assert a.snap_m[1] == pytest.approx(GRID_STEP_M, abs=1.0)


def test_no_passable_edges_falls_back_to_all_nodes():
    from fixtures import make_grid_graph
    G = make_grid_graph({k: {"highway": "steps"} for k in
                         [(0, 1), (1, 2), (3, 4), (4, 5), (6, 7), (7, 8),
                          (0, 3), (3, 6), (1, 4), (4, 7), (2, 5), (5, 8)]})
    annotate(G, Plane(0))
    nodes, _ = snap_nodes(G, [node_lonlat(G, 4)])
    assert nodes == [4]


def test_far_stop_snaps_with_large_distance(env):
    G, A, C, D = env
    r = route(G, [A, (A[0] + 0.1, A[1])], "shortest")
    assert r.reachable and r.snap_m[1] > 5000


def test_same_node_stops_no_edges(env):
    G, A, C, D = env
    r = route(G, [A, A], "accessible")
    assert r.reachable and r.edges == []
    m = route_metrics(G, r, [C])
    assert m["length_m"] == 0 and m["steps_count"] == 0
    assert m["max_grade_pct"] is None and m["mean_score"] is None
    assert m["toilets_300m"] == 0


def test_coords_are_continuous(env):
    G, A, C, D = env
    for mode in ("shortest", "accessible"):
        r = route(G, [A, C], mode)
        max_edge = max(d["length"] for _, _, d in G.edges(data=True))
        assert len(r.coords) == len(r.edges) + 1
        for p, q in zip(r.coords, r.coords[1:]):
            assert GEOD.inv(p[0], p[1], q[0], q[1])[2] <= max_edge + 0.5
        assert r.coords[0] == pytest.approx(A) and r.coords[-1] == pytest.approx(C)


def test_parallel_edges_pick_cheapest(env):
    G, A, C, D = env
    G.add_edge(6, 7, length=GRID_STEP_M, highway="footway", surface="asphalt")
    annotate(G, Plane(0))
    r = route(G, [A, node_lonlat(G, 7)], "accessible")
    assert r.edges == [(6, 7, 1)]


def test_toilets_within_300m(env):
    G, A, C, D = env
    r = route(G, [A, C], "shortest")
    mid = node_lonlat(G, 7)
    near = GEOD.fwd(mid[0], mid[1], 0, 100)[:2]
    far = GEOD.fwd(mid[0], mid[1], 0, 500)[:2]
    assert route_metrics(G, r, [near, far])["toilets_300m"] == 1


def test_metrics_values():
    G, n = make_route_graph()
    annotate(G, Plane(10))
    A, C = node_lonlat(G, n["A"]), node_lonlat(G, n["C"])
    m = route_metrics(G, route(G, [A, C], "shortest"), [])
    assert m["max_grade_pct"] > 5
    assert m["steep_m"] == pytest.approx(200, abs=1)
    assert m["cobble_m"] == 0
    assert m["mean_score"] is not None
    m2 = route_metrics(G, route(G, [A, C], "accessible"), [])
    assert m2["cobble_m"] > 0


def test_exempt_steps_not_counted():
    G, n = make_route_graph()
    G.edges[7, 8, 0]["ramp"] = "yes"
    annotate(G, Plane(0))
    r = route(G, [node_lonlat(G, 6), node_lonlat(G, 8)], "shortest")
    assert any(G.edges[e]["steps"] for e in r.edges)
    assert not any(G.edges[e]["blocked"] for e in r.edges)
    assert route_metrics(G, r, [])["steps_count"] == 0


def test_blocked_steps_counted_on_shortest(env):
    G, A, C, D = env
    assert route_metrics(G, route(G, [A, C], "shortest"), [])["steps_count"] == 1
