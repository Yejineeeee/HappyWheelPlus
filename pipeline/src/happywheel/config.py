from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml
from pyproj import Geod

_GEOD = Geod(ellps="WGS84")
MIN_RADIUS_M = 3000.0
RADIUS_MARGIN_M = 500.0


@dataclass(frozen=True)
class Stop:
    name: str
    lon: float
    lat: float


@dataclass(frozen=True)
class FieldRecord:
    difficulty: int  # 1~5
    stars: int  # 1~5
    note: str


@dataclass(frozen=True)
class Course:
    name: str
    time_label: str
    stops: tuple[Stop, ...]
    field: FieldRecord | None


@dataclass(frozen=True)
class City:
    id: str
    name_ko: str
    country_ko: str
    courses: tuple[Course, ...]
    center: tuple[float, float]  # (lon, lat), 모든 정류장 평균
    radius_m: float  # max(3000, 중심에서 가장 먼 정류장까지 거리 + 500)


def _rating(value, label: str, where: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 5:
        raise ValueError(f"{where}: {label} must be an integer in 1..5, got {value!r}")
    return value


def _parse_field(raw: dict | None, where: str) -> FieldRecord | None:
    if raw is None:
        return None
    return FieldRecord(
        difficulty=_rating(raw.get("difficulty"), "difficulty", where),
        stars=_rating(raw.get("stars"), "stars", where),
        note=str(raw.get("note", "")),
    )


def _parse_course(raw: dict, city_id: str) -> Course:
    where = f"{city_id}/{raw.get('name')}"
    stops = tuple(
        Stop(name=s["name"], lon=float(s["lon"]), lat=float(s["lat"]))
        for s in raw["stops"]
    )
    if not stops:
        raise ValueError(f"{where}: course has no stops")
    return Course(
        name=raw["name"],
        time_label=raw["time_label"],
        stops=stops,
        field=_parse_field(raw.get("field"), where),
    )


def _parse_city(raw: dict) -> City:
    courses = tuple(_parse_course(c, raw["id"]) for c in raw["courses"])
    stops = [s for c in courses for s in c.stops]
    if not stops:
        raise ValueError(f"{raw['id']}: city has no stops")
    lon = sum(s.lon for s in stops) / len(stops)
    lat = sum(s.lat for s in stops) / len(stops)
    far = max(_GEOD.inv(lon, lat, s.lon, s.lat)[2] for s in stops)
    return City(
        id=raw["id"],
        name_ko=raw["name_ko"],
        country_ko=raw["country_ko"],
        courses=courses,
        center=(lon, lat),
        radius_m=float(raw["radius_m"]) if raw.get("radius_m") is not None
        else max(MIN_RADIUS_M, far + RADIUS_MARGIN_M),
    )


def load_cities(path: Path) -> list[City]:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return [_parse_city(c) for c in data]
