import json
import math
from pathlib import Path

import pytest
from fixtures import Plane, make_grid_graph, make_route_graph, node_lonlat

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
    assert {e[8] for e in out["graph.json"]["edges"]} == ids
    assert len(ids) == len(out["graph.json"]["edges"])


def test_flags_bits(built):
    out = built[2]
    segs = {f["id"]: f["properties"] for f in out["segments.geojson"]["features"]}
    rows = [e for e in out["graph.json"]["edges"] if segs[e[8]]["steps"]]
    assert rows and all(e[7] == 3 for e in rows)
    plain = [e for e in out["graph.json"]["edges"] if not segs[e[8]]["steps"]]
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
    ids = {f["id"] for f in built[2]["segments.geojson"]["features"]}
    assert set(acc["seg_ids"]) <= ids


def test_unreachable_course(built):
    c = built[2]["courses.json"][1]
    assert c["reachable"] is False
    assert c["routes"]["accessible"] is None and c["comparison"] is None
    assert c["blocked_at"] is not None
    assert c["routes"]["shortest"]["coords"]


def test_surface_mix_sums_to_one(built):
    city, _, _, metrics = built
    idx = build_cities_index([city], {city.id: metrics})
    m = idx["cities"][0]["metrics"]
    assert sum(m["surface_mix"].values()) == pytest.approx(1, abs=1e-3)
    assert set(m["poi_per_km2"]) == {"toilet", "elevator", "bench", "fountain"}
    assert m["poi_per_km2"]["toilet"] == pytest.approx(1 / (math.pi * 9), rel=1e-3)
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
