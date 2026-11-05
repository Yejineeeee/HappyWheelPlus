from pathlib import Path

import pytest
import yaml

from happywheel.config import load_cities

CITIES = load_cities(Path(__file__).parents[1] / "config/cities.yaml")


def test_nine_cities_in_order():
    assert [c.id for c in CITIES] == [
        "london", "paris", "lucerne", "bern", "interlaken",
        "milan", "venice", "florence", "rome",
    ]


def test_course_counts():
    assert {c.id: len(c.courses) for c in CITIES} == {
        "london": 2, "paris": 2, "lucerne": 1, "bern": 1, "interlaken": 1,
        "milan": 2, "venice": 2, "florence": 2, "rome": 2,
    }


def test_field_records():
    fr = [(c.id, k.name) for c in CITIES for k in c.courses if k.field]
    assert len(fr) == 10
    rome = next(c for c in CITIES if c.id == "rome").courses[1].field
    assert (rome.difficulty, rome.stars) == (5, 1)


def test_center_and_radius():
    lu = next(c for c in CITIES if c.id == "lucerne")
    assert lu.radius_m == 3000  # 정류장이 서로 가까움
    assert abs(lu.center[0] - 8.30833) < 1e-4


def test_invalid_rating_rejected(tmp_path):
    data = [{
        "id": "x", "name_ko": "엑스", "country_ko": "나라",
        "courses": [{
            "name": "c", "time_label": "~10분",
            "stops": [{"name": "a", "lon": 1.0, "lat": 2.0}],
            "field": {"difficulty": 6, "stars": 3, "note": "n"},
        }],
    }]
    p = tmp_path / "bad.yaml"
    p.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    with pytest.raises(ValueError):
        load_cities(p)
