"""Geodesic helpers."""
from __future__ import annotations

import math

import numpy as np
import pyproj

GEOD = pyproj.Geod(ellps="WGS84")
EARTH_R = 6371008.8


def line_length_m(coords: list[tuple[float, float]]) -> float:
    if len(coords) < 2:
        return 0.0
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return float(GEOD.line_length(lons, lats))


def sample_along(coords, step_m: float = 10.0) -> list[tuple[float, float, float]]:
    """Points every step_m along the line, ends included: (lon, lat, cumulative m)."""
    coords = [tuple(c[:2]) for c in coords]
    if not coords:
        return []
    out = [(coords[0][0], coords[0][1], 0.0)]
    cum = 0.0  # distance at start of current segment
    next_d = step_m
    for (lon1, lat1), (lon2, lat2) in zip(coords, coords[1:]):
        az, _, seg = GEOD.inv(lon1, lat1, lon2, lat2)
        if seg <= 0:
            continue
        while next_d <= cum + seg + 1e-9:
            off = min(max(next_d - cum, 0.0), seg)
            lon, lat, _ = GEOD.fwd(lon1, lat1, az, off)
            out.append((lon, lat, next_d))
            next_d += step_m
        cum += seg
    if cum - out[-1][2] > 1e-3:
        out.append((coords[-1][0], coords[-1][1], cum))
    return out


def to_local_xy(lonlats, lat0: float) -> np.ndarray:
    """Equirectangular approximation in metres, shape (n, 2)."""
    arr = np.asarray(lonlats, dtype=float).reshape(-1, 2)
    k = math.cos(math.radians(lat0))
    x = np.radians(arr[:, 0]) * EARTH_R * k
    y = np.radians(arr[:, 1]) * EARTH_R
    return np.column_stack([x, y])


def point_line_distance_m(pt, line_coords) -> float:
    """Shortest distance (m) from a point to a polyline, in a local projection."""
    lat0 = pt[1]
    p = to_local_xy([pt], lat0)[0]
    pts = to_local_xy(line_coords, lat0)
    if len(pts) == 1:
        return float(np.hypot(*(pts[0] - p)))
    best = math.inf
    for a, b in zip(pts, pts[1:]):
        ab = b - a
        denom = float(ab @ ab)
        t = 0.0 if denom == 0 else min(1.0, max(0.0, float((p - a) @ ab) / denom))
        best = min(best, float(np.hypot(*(a + t * ab - p))))
    return best
