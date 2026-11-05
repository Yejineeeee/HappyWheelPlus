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
