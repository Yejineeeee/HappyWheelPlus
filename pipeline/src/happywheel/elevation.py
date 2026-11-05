"""Copernicus GLO-30 DEM sampling and per-edge grade."""
from __future__ import annotations

import math
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Protocol

import numpy as np

from .geo import sample_along

TILE_URL = "https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"


DOWNLOAD_ATTEMPTS = 3

# Copernicus GLO-30 is a surface model (buildings/trees included). Grey opening removes
# features narrower than the window, the gaussian smooths the staircase it leaves.
TERRAIN_OPENING_PX = 5
TERRAIN_SIGMA_PX = 1.5


class IncompleteDownload(OSError):
    pass


class ElevationSource(Protocol):
    def elevations(self, lonlats: list[tuple[float, float]]) -> list[float | None]: ...


def tile_name(lat_floor: int, lon_floor: int) -> str:
    ns = "N" if lat_floor >= 0 else "S"
    ew = "E" if lon_floor >= 0 else "W"
    return (f"Copernicus_DSM_COG_10_{ns}{abs(lat_floor):02d}_00_"
            f"{ew}{abs(lon_floor):03d}_00_DEM")


def terrain_correct(arr: np.ndarray, nodata: float | None) -> np.ndarray:
    """Suppress buildings/trees: grey opening then gaussian smoothing. Invalid pixels stay NaN."""
    from scipy import ndimage
    a = np.asarray(arr, dtype=float).copy()
    invalid = ~np.isfinite(a) | (a < -1000)
    if nodata is not None:
        invalid |= a == nodata
    if invalid.all():
        return np.full(a.shape, np.nan)
    # fill invalid pixels with the valid max so they never pull valid neighbours down in the
    # opening. The gaussian also smooths the filled array, so there is a small edge effect
    # (values pulled up) within ~2 px of coast/nodata; invalid pixels are restored to NaN after.
    a[invalid] = a[~invalid].max()
    a = ndimage.grey_opening(a, size=(TERRAIN_OPENING_PX, TERRAIN_OPENING_PX))
    a = ndimage.gaussian_filter(a, sigma=TERRAIN_SIGMA_PX)
    a[invalid] = np.nan
    return a


def sample_bilinear(arr: np.ndarray, transform, lonlats) -> list[float | None]:
    """Bilinear elevation at lon/lat points; None if any of the 4 neighbours is NaN."""
    from scipy import ndimage
    if len(lonlats) == 0:
        return []
    inv = ~transform
    xy = [inv @ (float(lon), float(lat)) for lon, lat in lonlats]
    cols = np.array([p[0] for p in xy]) - 0.5  # pixel-centre coordinates
    rows = np.array([p[1] for p in xy]) - 0.5
    cols = np.clip(cols, 0, arr.shape[1] - 1)
    rows = np.clip(rows, 0, arr.shape[0] - 1)
    nan = np.isnan(arr)
    filled = np.where(nan, 0.0, arr)
    vals = ndimage.map_coordinates(filled, [rows, cols], order=1, mode="nearest")
    bad = ndimage.map_coordinates(nan.astype(float), [rows, cols], order=1, mode="nearest") > 0
    return [None if b else float(v) for v, b in zip(vals, bad)]


class CopernicusDEM:
    def __init__(self, bbox: tuple[float, float, float, float], cache_dir: Path,
                 correct_terrain: bool = True):
        self.bbox = bbox
        self.correct_terrain = correct_terrain
        self.dem_dir = Path(cache_dir) / "dem"
        self.dem_dir.mkdir(parents=True, exist_ok=True)
        self._tiles: dict[str, tuple | None] = {}
        west, south, east, north = bbox
        for lat in range(math.floor(south), math.floor(north) + 1):
            for lon in range(math.floor(west), math.floor(east) + 1):
                self._tile(lat, lon)

    def _fetch(self, name: str, path: Path) -> Path | None:
        """One download attempt; resumes from an existing .part when the server allows."""
        part = path.with_suffix(".tif.part")
        start = part.stat().st_size if part.exists() else 0
        headers = {"Range": f"bytes={start}-"} if start else {}
        req = urllib.request.Request(TILE_URL.format(name=name), headers=headers)
        try:
            resp_cm = urllib.request.urlopen(req, timeout=60)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                part.unlink(missing_ok=True)
                return None
            if e.code == 416:  # stale/oversized .part: start over
                part.unlink(missing_ok=True)
            raise
        with resp_cm as r:
            status = getattr(r, "status", 200)
            if start and status == 206:
                total = int(r.headers["Content-Range"].rsplit("/", 1)[1])
                mode = "ab"
            else:
                start = 0
                total = int(r.headers["Content-Length"])
                mode = "wb"
            with open(part, mode) as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
        size = part.stat().st_size
        if size != total:
            raise IncompleteDownload(f"{name}: got {size} of {total} bytes")
        import rasterio
        try:
            with rasterio.open(part):
                pass
        except rasterio.errors.RasterioIOError:
            part.unlink(missing_ok=True)
            raise
        os.replace(part, path)
        return path

    def _download(self, name: str) -> Path | None:
        path = self.dem_dir / f"{name}.tif"
        if path.exists():
            return path
        last: Exception | None = None
        for _ in range(DOWNLOAD_ATTEMPTS):
            try:
                return self._fetch(name, path)
            except OSError as e:  # incl. URLError, HTTPError, IncompleteDownload
                last = e
            except Exception as e:  # unreadable raster
                last = e
        assert last is not None
        raise last

    def _open(self, name: str):
        import rasterio
        path = self._download(name)
        if path is None:
            return None
        try:
            ds = rasterio.open(path)
        except rasterio.errors.RasterioIOError:
            path.unlink(missing_ok=True)  # corrupt cache: evict, re-download once
            path = self._download(name)
            if path is None:
                return None
            ds = rasterio.open(path)
        with ds:
            arr, transform, nodata = ds.read(1), ds.transform, ds.nodata
        if self.correct_terrain:
            arr = terrain_correct(arr, nodata)
        else:
            arr = np.array(self._clean_array(arr, nodata))
        return (arr, transform, nodata)

    def _tile(self, lat_floor: int, lon_floor: int):
        name = tile_name(lat_floor, lon_floor)
        if name not in self._tiles:
            self._tiles[name] = self._open(name)
        return self._tiles[name]

    @staticmethod
    def _clean(values: list[float], nodata: float | None = None) -> list[float | None]:
        out: list[float | None] = []
        for v in values:
            v = float(v)
            if math.isnan(v) or v < -1000 or (nodata is not None and v == nodata):
                out.append(None)
            else:
                out.append(v)
        return out

    @staticmethod
    def _clean_array(arr, nodata):
        a = np.asarray(arr, dtype=float).copy()
        bad = ~np.isfinite(a) | (a < -1000)
        if nodata is not None:
            bad |= a == nodata
        a[bad] = np.nan
        return a

    def elevations(self, lonlats):
        result: list[float | None] = [None] * len(lonlats)
        groups: dict[tuple[int, int], list[int]] = {}
        for i, (lon, lat) in enumerate(lonlats):
            groups.setdefault((math.floor(lat), math.floor(lon)), []).append(i)
        for (latf, lonf), idxs in groups.items():
            tile = self._tile(latf, lonf)
            if tile is None:
                continue
            arr, transform, _ = tile
            vals = sample_bilinear(arr, transform, [lonlats[i] for i in idxs])
            for i, v in zip(idxs, vals):
                result[i] = v
        return result


def grade_from_samples(samples, elev, min_run_m: float = 30.0
                       ) -> tuple[float | None, float | None]:
    """(mean |grade| %, max |grade| %) from samples [(lon, lat, dist)] and matching elevations."""
    if len(samples) < 2:
        return None, None
    dist = [p[2] for p in samples]
    grades: list[float] = []
    if dist[-1] < min_run_m:
        if elev[0] is None or elev[-1] is None:
            return None, None
        grades.append(abs(elev[-1] - elev[0]) / min_run_m * 100)
    else:
        j = 0
        for i in range(len(samples)):
            if j < i:
                j = i
            while j < len(samples) and dist[j] - dist[i] < min_run_m:
                j += 1
            if j >= len(samples):
                break
            if elev[i] is None or elev[j] is None:
                continue
            grades.append(abs(elev[j] - elev[i]) / (dist[j] - dist[i]) * 100)
    if not grades:
        return None, None
    return sum(grades) / len(grades), max(grades)


def edge_grade(coords, src: ElevationSource, step_m: float = 10.0,
               min_run_m: float = 30.0) -> tuple[float | None, float | None]:
    """(mean |grade| %, max |grade| %) over sliding windows of >= min_run_m."""
    pts = sample_along(coords, step_m)
    if len(pts) < 2:
        return None, None
    elev = src.elevations([(p[0], p[1]) for p in pts])
    return grade_from_samples(pts, elev, min_run_m)


def profile(coords, src: ElevationSource,
            step_m: float = 25.0) -> list[tuple[float, float | None]]:
    pts = sample_along(coords, step_m)
    elev = src.elevations([(p[0], p[1]) for p in pts])
    return [(p[2], e) for p, e in zip(pts, elev)]
