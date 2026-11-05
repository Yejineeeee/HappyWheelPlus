import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import pytest
from fixtures import GRID_STEP_M, Plane, make_route_graph, node_lonlat

from happywheel.geo import GEOD, to_local_xy
from happywheel.network import annotate
from happywheel.routing import ALPHA, nearest_node, route, route_metrics


@pytest.fixture
def env():
    G, n = make_route_graph()
    annotate(G, Plane(0))
    return G, node_lonlat(G, n["A"]), node_lonlat(G, n["C"]), node_lonlat(G, n["D"])


def steps_in(G, r):
    return sum(1 for e in r.edges if G.edges[e]["steps"])


def test_alpha():
    assert ALPHA == 3.0


def test_nearest_node(env):
    G, A, C, D = env
    lon, lat, _ = GEOD.fwd(A[0], A[1], 45, 10)
    assert nearest_node(G, lon, lat) == 6
    assert nearest_node(G, *C) == 8


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


def test_unreachable_stop_reports_blocked(env):
    G, A, C, D = env
    r = route(G, [A, D], "accessible")
    assert not r.reachable and r.blocked_at == A


def test_blocked_keeps_partial_route(env):
    G, A, C, D = env
    r = route(G, [A, C, D], "accessible")
    assert not r.reachable and r.blocked_at == C
    assert r.edges and r.coords[-1] == pytest.approx(C)


def test_shortest_disconnected_graph(env):
    G, A, C, D = env
    G.add_node(10, x=A[0] + 0.1, y=A[1])
    r = route(G, [A, (A[0] + 0.1, A[1])], "shortest")
    assert not r.reachable and r.blocked_at == A


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
