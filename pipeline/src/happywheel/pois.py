"""Amenity (POI) collection from OpenStreetMap with a JSON cache."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from .config import City

PoiKind = Literal["toilet", "elevator", "bench", "fountain"]
POI_KINDS: tuple[str, ...] = ("toilet", "elevator", "bench", "fountain")
_TAGS = {"amenity": ["toilets", "bench", "drinking_water"], "highway": "elevator"}
_AMENITY_KIND = {"toilets": "toilet", "bench": "bench", "drinking_water": "fountain"}
_WHEELCHAIR = {"yes", "limited", "no"}


def _text(v) -> str | None:
    if v is None or (isinstance(v, float) and v != v):
        return None
    s = str(v).strip()
    return s or None


def _kind(row) -> str | None:
    if _text(row.get("highway")) == "elevator":
        return "elevator"
    return _AMENITY_KIND.get(_text(row.get("amenity")))


def fetch_pois(city: City, cache_dir: Path) -> list[dict]:
    cache_dir = Path(cache_dir)
    path = cache_dir / f"{city.id}_r{int(city.radius_m)}_pois.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    import osmnx as ox
    from osmnx._errors import InsufficientResponseError

    ox.settings.cache_folder = str(cache_dir / "osmnx")
    lon, lat = city.center
    try:
        gdf = ox.features_from_point((lat, lon), tags=_TAGS, dist=city.radius_m)
    except InsufficientResponseError:
        gdf = None
    pois: list[dict] = []
    for idx, row in (gdf.iterrows() if gdf is not None else ()):
        kind = _kind(row)
        geom = row.geometry
        if kind is None or geom is None or geom.is_empty:
            continue
        p = geom if geom.geom_type == "Point" else geom.representative_point()
        etype, eid = idx
        wc = _text(row.get("wheelchair"))
        pois.append({
            "kind": kind,
            "name": _text(row.get("name")),
            "wheelchair": wc if wc in _WHEELCHAIR else None,
            "osm_id": f"{etype}/{eid}",
            "lon": round(float(p.x), 5),
            "lat": round(float(p.y), 5),
        })
    pois.sort(key=lambda d: (d["kind"], d["osm_id"]))
    cache_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(pois, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    return pois
