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


class IncompleteDownload(OSError):
    pass


class ElevationSource(Protocol):
    def elevations(self, lonlats: list[tuple[float, float]]) -> list[float | None]: ...


def tile_name(lat_floor: int, lon_floor: int) -> str:
    ns = "N" if lat_floor >= 0 else "S"
    ew = "E" if lon_floor >= 0 else "W"
    return (f"Copernicus_DSM_COG_10_{ns}{abs(lat_floor):02d}_00_"
            f"{ew}{abs(lon_floor):03d}_00_DEM")


class CopernicusDEM:
    def __init__(self, bbox: tuple[float, float, float, float], cache_dir: Path):
        self.bbox = bbox
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
            return (ds.read(1), ds.transform, ds.nodata)

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

    def elevations(self, lonlats):
        from rasterio.transform import rowcol
        result: list[float | None] = [None] * len(lonlats)
        groups: dict[tuple[int, int], list[int]] = {}
        for i, (lon, lat) in enumerate(lonlats):
            groups.setdefault((math.floor(lat), math.floor(lon)), []).append(i)
        for (latf, lonf), idxs in groups.items():
            tile = self._tile(latf, lonf)
            if tile is None:
                continue
            arr, transform, nodata = tile
            xs = [lonlats[i][0] for i in idxs]
            ys = [lonlats[i][1] for i in idxs]
            rows, cols = rowcol(transform, xs, ys)
            rows = np.clip(np.asarray(rows), 0, arr.shape[0] - 1)
            cols = np.clip(np.asarray(cols), 0, arr.shape[1] - 1)
            vals = self._clean(arr[rows, cols].tolist(), nodata)
            for i, v in zip(idxs, vals):
                result[i] = v
        return result


def edge_grade(coords, src: ElevationSource, step_m: float = 10.0,
               min_run_m: float = 30.0) -> tuple[float | None, float | None]:
    """(mean |grade| %, max |grade| %) over sliding windows of >= min_run_m."""
    pts = sample_along(coords, step_m)
    if len(pts) < 2:
        return None, None
    elev = src.elevations([(p[0], p[1]) for p in pts])
    dist = [p[2] for p in pts]
    grades: list[float] = []
    if dist[-1] < min_run_m:
        if elev[0] is None or elev[-1] is None:
            return None, None
        grades.append(abs(elev[-1] - elev[0]) / min_run_m * 100)
    else:
        j = 0
        for i in range(len(pts)):
            if j < i:
                j = i
            while j < len(pts) and dist[j] - dist[i] < min_run_m:
                j += 1
            if j >= len(pts):
                break
            if elev[i] is None or elev[j] is None:
                continue
            grades.append(abs(elev[j] - elev[i]) / (dist[j] - dist[i]) * 100)
    if not grades:
        return None, None
    return sum(grades) / len(grades), max(grades)


def profile(coords, src: ElevationSource,
            step_m: float = 25.0) -> list[tuple[float, float | None]]:
    pts = sample_along(coords, step_m)
    elev = src.elevations([(p[0], p[1]) for p in pts])
    return [(p[2], e) for p, e in zip(pts, elev)]
