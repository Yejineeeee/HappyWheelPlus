import pytest
from fixtures import Holes, Plane, first_edge, make_grid_graph

from happywheel.network import annotate, parse_incline


def test_annotate_adds_keys():
    G = make_grid_graph()
    annotate(G, Plane(0))
    d = first_edge(G)
    assert {"p_slope", "p_surface", "p_kerb", "p_unc", "score", "blocked", "length",
            "coords", "grade_max", "grade_mean", "surface_class", "steps",
            "wc_yes"} <= d.keys()
    assert len(d["coords"]) == 2
    assert d["grade_max"] == pytest.approx(0, abs=0.01)
    assert d["score"] == pytest.approx(100 - 0.3 * 15, abs=0.01)  # unknown surface only


def test_steps_edge_blocked_and_unscored():
    G = make_grid_graph()
    annotate(G, Plane(0))
    d = first_edge(G, 0, 3)
    assert d["steps"] and d["blocked"] and d["score"] is None


def test_bridge_ignores_dem():
    G = make_grid_graph()
    annotate(G, Plane(10))
    assert first_edge(G, 1, 2)["grade_max"] is None
    assert first_edge(G, 0, 1)["grade_max"] > 5


def test_incline_tag_used():
    G = make_grid_graph()
    annotate(G, Plane(0))
    d = first_edge(G, 4, 5)
    assert d["grade_max"] == 9.0 and d["grade_mean"] == 9.0


def test_kerb_from_nodes():
    G = make_grid_graph()
    annotate(G, Plane(0))
    assert first_edge(G, 5, 8)["p_kerb"] == 60
    assert first_edge(G, 0, 1)["p_kerb"] == 0


def test_surface_and_geometry_fallback():
    G = make_grid_graph()
    annotate(G, Plane(0))
    d = first_edge(G, 3, 4)
    assert d["surface_class"] == "cobble" and d["p_surface"] == 70
    assert d["coords"][0] == (G.nodes[3]["x"], G.nodes[3]["y"])


def test_missing_dem_gives_none_and_uncertainty():
    G = make_grid_graph()
    annotate(G, Holes(all=True))
    d = first_edge(G)
    assert d["grade_max"] is None and d["p_unc"] == 30


def test_length_computed_when_absent():
    G = make_grid_graph()
    del G.edges[0, 1, 0]["length"]
    annotate(G, Plane(0))
    assert first_edge(G)["length"] == pytest.approx(100, abs=0.5)


def test_elevations_batched():
    calls = []
    inner = Plane(0)

    class Spy:
        def elevations(self, pts):
            calls.append(len(pts))
            return inner.elevations(pts)

    annotate(make_grid_graph(), Spy())
    assert len(calls) == 1


@pytest.mark.parametrize("raw,exp", [
    ("12%", 12.0), ("-5%", 5.0), ("8.5%", 8.5), ("5", 5.0), (["up"], None),
    ("up", None), ("yes", None), (None, None), ("-9 %", 9.0),
])
def test_parse_incline(raw, exp):
    assert parse_incline(raw) == exp


def test_fetch_uses_v2_cache_name(tmp_path, monkeypatch):
    import osmnx as ox
    from happywheel.config import City
    from happywheel.network import fetch_network
    from fixtures import make_grid_graph
    G = make_grid_graph()
    city = City("testcity", "테스트", "테스트", (), (2.33, 48.86), 3000.0)
    ox.save_graphml(G, tmp_path / "testcity_walk_v2.graphml")

    def boom(*a, **k):
        raise AssertionError("network fetched")
    monkeypatch.setattr(ox, "graph_from_point", boom)
    assert fetch_network(city, tmp_path).number_of_nodes() == 9
