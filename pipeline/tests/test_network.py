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


def test_kerb_node_survives_simplification():
    from fixtures import make_raw_chain
    from happywheel.network import simplify_walk
    G = simplify_walk(make_raw_chain(kerb_node=1))
    assert 1 in G.nodes and G.nodes[1]["kerb"] == "raised"
    annotate(G, Plane(0))
    adjacent = [d for u, v, d in G.edges(data=True) if 1 in (u, v)]
    assert len(adjacent) == 2 and all(d["p_kerb"] == 60 for d in adjacent)


def test_plain_degree2_nodes_still_simplified():
    from fixtures import make_raw_chain
    from happywheel.network import simplify_walk
    G = simplify_walk(make_raw_chain(kerb_node=None))
    assert sorted(G.nodes) == [0, 3] and G.number_of_edges() == 1


def test_simplify_order_identical_after_graphml_roundtrip(tmp_path):
    import osmnx as ox
    from fixtures import make_grid_graph
    from happywheel.network import simplify_walk
    raw = make_grid_graph().to_directed()
    ox.save_graphml(raw, tmp_path / "raw.graphml")
    a = simplify_walk(raw)
    b = simplify_walk(ox.load_graphml(tmp_path / "raw.graphml"))
    assert list(a.edges(keys=True)) == list(b.edges(keys=True))
    assert list(a.nodes) == list(b.nodes)


def _city():
    from happywheel.config import City
    return City("testcity", "테스트", "테스트", (), (2.33, 48.86), 3000.0)


def test_fetch_uses_raw_cache_and_simplifies(tmp_path, monkeypatch):
    import osmnx as ox
    from fixtures import make_raw_chain
    from happywheel.network import fetch_network
    ox.save_graphml(make_raw_chain(kerb_node=1), tmp_path / "testcity_r3000_walk_raw.graphml")

    def boom(*a, **k):
        raise AssertionError("network fetched")
    monkeypatch.setattr(ox, "graph_from_point", boom)
    G = fetch_network(_city(), tmp_path)
    assert sorted(G.nodes) == [0, 1, 3] and not G.is_directed()


def test_fetch_downloads_raw_unsimplified_and_caches(tmp_path, monkeypatch):
    import osmnx as ox
    from fixtures import make_raw_chain
    from happywheel.network import fetch_network
    seen = {}

    def fake(*a, **k):
        seen.update(k)
        return make_raw_chain(kerb_node=1)
    monkeypatch.setattr(ox, "graph_from_point", fake)
    G = fetch_network(_city(), tmp_path)
    assert seen["simplify"] is False and sorted(G.nodes) == [0, 1, 3]
    assert (tmp_path / "testcity_r3000_walk_raw.graphml").exists()
    monkeypatch.setattr(ox, "graph_from_point", lambda *a, **k: 1 / 0)
    assert list(fetch_network(_city(), tmp_path).edges(keys=True)) == list(G.edges(keys=True))


def test_cache_path_depends_on_radius(tmp_path, monkeypatch):
    import osmnx as ox
    from fixtures import make_raw_chain
    from happywheel.config import City
    from happywheel.network import fetch_network
    ox.save_graphml(make_raw_chain(), tmp_path / "t_r3000_walk_raw.graphml")
    called = []

    def fake(*a, **k):
        called.append(1)
        raise RuntimeError("fetch attempted")
    monkeypatch.setattr(ox, "graph_from_point", fake)
    assert fetch_network(City("t", "t", "t", (), (2.33, 48.86), 3000.0), tmp_path)
    with pytest.raises(RuntimeError):
        fetch_network(City("t", "t", "t", (), (2.33, 48.86), 2700.0), tmp_path)
    assert called
