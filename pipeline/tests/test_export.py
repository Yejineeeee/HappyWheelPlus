import hashlib
import json
from pathlib import Path

import pytest
from fixtures import Plane, make_grid_graph, make_route_graph, node_lonlat
from shapely.geometry import LineString

from happywheel.config import City, Course, FieldRecord, Stop
from happywheel.export import (build_cities_index, build_city_outputs, write_outputs)
from happywheel.network import annotate


@pytest.fixture(scope="module")
def built():
    G, n = make_route_graph()
    src = Plane(3)
    annotate(G, src)
    a, c, d = (node_lonlat(G, n[k]) for k in "ACD")
    fld = FieldRecord(difficulty=2, stars=5, note="메모")
    courses = (
        Course("A-C", "~60분", (Stop("A", *a), Stop("C", *c)), fld),
        Course("A-D", "~30분", (Stop("A", *a), Stop("D", *d)), None),
    )
    city = City("testcity", "테스트", "국가", courses, center=a, radius_m=3000.0)
    pois = [
        {"kind": "toilet", "name": "WC", "wheelchair": "yes", "osm_id": "node/1",
         "lon": a[0], "lat": a[1]},
        {"kind": "bench", "name": None, "wheelchair": None, "osm_id": "way/2",
         "lon": c[0], "lat": c[1]},
    ]
    out, metrics = build_city_outputs(city, G, pois, src)
    return city, G, out, metrics


def test_outputs_have_contract_files(built):
    assert set(built[2]) == {"segments.geojson", "graph.json", "pois.geojson", "courses.json"}


def test_graph_seg_ids_match_segments(built):
    out = built[2]
    ids = {f["id"] for f in out["segments.geojson"]["features"]}
    rows = out["graph.json"]["edges"]
    assert ids == set(range(len(rows)))  # seg_id is the row index
    assert all(len(e) == 8 for e in rows)
    assert all("id" not in f["properties"] for f in out["segments.geojson"]["features"])


def test_flags_bits(built):
    out = built[2]
    segs = {f["id"]: f["properties"] for f in out["segments.geojson"]["features"]}
    edges = list(enumerate(out["graph.json"]["edges"]))
    rows = [e for i, e in edges if segs[i]["steps"]]
    assert rows and all(e[7] == 3 for e in rows)
    plain = [e for i, e in edges if not segs[i]["steps"]]
    assert all(e[7] == 0 for e in plain)


def test_course_shape(built):
    cs = built[2]["courses.json"]
    c = cs[0]
    assert {"index", "name", "stops", "field", "reachable", "routes", "comparison"} <= c.keys()
    assert c["reachable"] and c["comparison"]["extra_m"] > 0
    assert c["comparison"]["steps_avoided"] == 1
    assert c["field"] == {"difficulty": 2, "stars": 5, "note": "메모"}
    acc = c["routes"]["accessible"]
    assert acc["seg_ids"] and acc["profile"] and acc["profile"][0][0] == 0
    assert all(len(row) == 3 for row in acc["profile"])
    ids = {f["id"] for f in built[2]["segments.geojson"]["features"]}
    assert set(acc["seg_ids"]) <= ids


def test_island_stop_course_is_snapped_and_reachable(built):
    c = built[2]["courses.json"][1]
    assert c["reachable"] is True and c["blocked_at"] is None
    assert c["routes"]["accessible"] is not None and c["comparison"] is not None
    assert c["routes"]["shortest"]["coords"]


def test_surface_mix_sums_to_one(built):
    city, _, _, metrics = built
    idx = build_cities_index([city], {city.id: {**metrics, "data_version": "abc"}})
    m = idx["cities"][0]["metrics"]
    assert sum(m["surface_mix"].values()) == pytest.approx(1, abs=1e-3)
    assert set(m["poi_per_km2"]) == {"toilet", "elevator", "bench", "fountain"}
    assert m["poi_per_km2"]["toilet"] == pytest.approx(1 / 36, rel=1e-3)  # square of side 2r = 6 km
    assert m["area_km2"] == 36.0
    assert idx["cities"][0]["course_count"] == 2
    assert idx["alpha"] == 3.0 and idx["weights_default"]["slope"] == 1.0
    assert build_cities_index([city], {})["cities"] == []


def test_no_nan_in_json(built, tmp_path):
    city, _, out, _ = built
    write_outputs(tmp_path, city.id, out)

    def bad(x):
        raise ValueError(x)
    for name in out:
        with open(tmp_path / city.id / name, encoding="utf-8") as f:
            json.load(f, parse_constant=bad)


def test_coordinate_precision(built):
    out = built[2]
    for x, y in out["graph.json"]["nodes"]:
        assert round(x, 5) == x and round(y, 5) == y
    for f in out["segments.geojson"]["features"]:
        for x, y in f["geometry"]["coordinates"]:
            assert round(x, 5) == x and round(y, 5) == y
    for x, y in out["courses.json"][0]["routes"]["shortest"]["coords"]:
        assert round(x, 5) == x and round(y, 5) == y


def test_metrics_course_count_public(built):
    assert built[3]["course_count"] == 2 and "_course_count" not in built[3]
    city = built[0]
    m = build_cities_index([city], {city.id: {**built[3], "data_version": "abc"}})["cities"][0]
    assert "course_count" not in m["metrics"] and m["course_count"] == 2
    assert "data_version" not in m["metrics"] and m["data_version"] == "abc"


def test_fetch_pois_empty_result(tmp_path, monkeypatch):
    import osmnx as ox
    from osmnx._errors import InsufficientResponseError

    from happywheel.pois import fetch_pois

    def boom(*a, **k):
        raise InsufficientResponseError("none")
    monkeypatch.setattr(ox, "features_from_point", boom)
    city = City("emptyville", "x", "y", (Course("c", "t", (Stop("s", 1.0, 2.0),), None),),
                center=(1.0, 2.0), radius_m=3000.0)
    assert fetch_pois(city, tmp_path) == []
    assert json.loads((tmp_path / "emptyville_r3000_pois.json").read_text(encoding="utf-8")) == []


def test_snap_max_and_approximate_flag(built):
    city, G, out, _ = built
    normal = out["courses.json"][0]
    assert normal["snap_max_m"] == pytest.approx(0.0, abs=1.0) and normal["approximate"] is False
    island = out["courses.json"][1]  # stop D is 100 m from the main component
    assert island["snap_max_m"] == pytest.approx(100.0, abs=1.0) and island["approximate"] is False


def test_far_stop_marks_course_approximate():
    from happywheel.export import APPROX_SNAP_M
    from happywheel.geo import GEOD
    G, n = make_route_graph()
    src = Plane(3)
    annotate(G, src)
    a, c = node_lonlat(G, n["A"]), node_lonlat(G, n["C"])
    lon, lat, _ = GEOD.fwd(c[0], c[1], 90, 400.0)  # 400 m east of C, 300 m beyond node 9
    city = City("far", "x", "y", (Course("far", "t", (Stop("A", *a), Stop("F", lon, lat)), None),),
                center=a, radius_m=3000.0)
    out, _ = build_city_outputs(city, G, [], src)
    course = out["courses.json"][0]
    assert APPROX_SNAP_M == 150.0
    assert course["approximate"] is True
    assert course["snap_max_m"] == pytest.approx(400.0, abs=3.0)


def test_segment_coords_run_from_u_to_v():
    G = make_grid_graph()
    for u, v, d in G.edges(data=True):  # geometry digitised against the graph direction
        if (u + v) % 2:
            d["geometry"] = LineString([(G.nodes[v]["x"], G.nodes[v]["y"]),
                                        (G.nodes[u]["x"], G.nodes[u]["y"])])
    src = Plane(0)
    annotate(G, src)
    a = node_lonlat(G, 0)
    city = City("o", "x", "y", (Course("c", "t", (Stop("A", *a), Stop("B", *a)), None),),
                center=a, radius_m=3000.0)
    out, _ = build_city_outputs(city, G, [], src)
    nodes = out["graph.json"]["nodes"]
    feats = out["segments.geojson"]["features"]
    assert any((u + v) % 2 for u, v in G.edges())
    for f, (u, v, *_rest) in zip(feats, out["graph.json"]["edges"]):
        c = f["geometry"]["coordinates"]
        assert c[0] == nodes[u] and c[-1] == nodes[v]


def test_graph_json_node_elevations(built):
    g = built[2]["graph.json"]
    assert len(g["elev"]) == len(g["nodes"])
    assert all(e is not None and round(e, 1) == e for e in g["elev"])
    assert g["elev"][8] > g["elev"][6]  # Plane(3) rises eastward


class River:
    """Banks at 10 (west of the bridge) and 20 (east); a deep trough strictly between."""

    def __init__(self, lon1, lon2):
        self.lon1, self.lon2 = lon1, lon2

    def elevations(self, lonlats):
        eps = 1e-9
        return [10.0 if lon <= self.lon1 + eps else 20.0 if lon >= self.lon2 - eps else -5.0
                for lon, _ in lonlats]


def test_bridge_profile_interpolates_instead_of_sampling_dem():
    G = make_grid_graph({(1, 2): {"bridge": "yes"}}, node_tags={})
    src = River(G.nodes[1]["x"], G.nodes[2]["x"])
    annotate(G, src)
    a, b = node_lonlat(G, 0), node_lonlat(G, 2)
    city = City("br", "x", "y", (Course("c", "t", (Stop("A", *a), Stop("B", *b)), None),),
                center=a, radius_m=3000.0)
    out, _ = build_city_outputs(city, G, [], src)
    prof = out["courses.json"][0]["routes"]["accessible"]["profile"]
    assert min(e for _, e, _ in prof) >= 10.0  # never dips into the river
    by_d = {round(d): (e, g) for d, e, g in prof}
    assert by_d[125][0] == pytest.approx(12.5, abs=0.2)
    assert by_d[150][0] == pytest.approx(15.0, abs=0.2)
    assert by_d[175][0] == pytest.approx(17.5, abs=0.2)
    assert by_d[200][0] == pytest.approx(20.0, abs=0.2)
    assert by_d[50][1] is not None and by_d[150][1] is None  # grade of the segment underfoot


def _unreachable():
    G = make_grid_graph({k: {"highway": "steps"} for k in (
        (0, 1), (1, 2), (3, 4), (4, 5), (6, 7), (7, 8), (0, 3), (3, 6), (1, 4), (4, 7),
        (2, 5), (5, 8))}, node_tags={})
    src = Plane(3)
    annotate(G, src)
    a, c = node_lonlat(G, 0), node_lonlat(G, 8)
    city = City("blocked", "막힘", "나라", (
        Course("막힌 코스", "~10분", (Stop("A", *a), Stop("C", *c)), None),),
        center=a, radius_m=3000.0)
    out, _ = build_city_outputs(city, G, [], src)
    return json.loads(json.dumps(out["courses.json"], ensure_ascii=False))


def test_unreachable_course_shape_is_pinned():
    c = _unreachable()[0]
    assert c["reachable"] is False and c["blocked_at"] is not None
    assert c["routes"]["accessible"] is None and c["comparison"] is None
    assert c["routes"]["shortest"]["coords"]
    assert "approximate" in c and "snap_max_m" in c
    pinned = Path(__file__).parent / "data" / "courses_unreachable.json"
    assert json.loads(pinned.read_text(encoding="utf-8")) == [c]


def test_write_outputs_returns_data_version(tmp_path):
    out = {"b.json": {"x": 1}, "a.json": [1, 2]}
    ver = write_outputs(tmp_path, "c", out)
    h = hashlib.sha256()
    for name in sorted(out):
        h.update((tmp_path / "c" / name).read_bytes())
    assert ver == h.hexdigest()[:12] and len(ver) == 12
    out["a.json"] = [1, 3]
    assert write_outputs(tmp_path, "c", out) != ver
