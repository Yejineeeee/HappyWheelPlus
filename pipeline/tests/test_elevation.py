import numpy as np
import pytest
from affine import Affine
from fixtures import Holes, Plane

from happywheel.elevation import (CopernicusDEM, edge_grade, profile, sample_bilinear,
                                  terrain_correct, tile_name)
from happywheel.geo import GEOD, line_length_m, sample_along, point_line_distance_m

LON0, LAT0 = 2.33, 48.86


def east_line(length_m):
    lon1, lat1, _ = GEOD.fwd(LON0, LAT0, 90, length_m)
    return [(LON0, LAT0), (lon1, lat1)]


def test_tile_name():
    assert tile_name(48, 2) == "Copernicus_DSM_COG_10_N48_00_E002_00_DEM"
    assert tile_name(-1, -3) == "Copernicus_DSM_COG_10_S01_00_W003_00_DEM"


def test_sample_along_spacing():
    pts = sample_along(east_line(100))
    assert len(pts) == 11
    assert pts[0][2] == 0
    assert pts[-1][2] == pytest.approx(100, abs=0.5)


def test_line_length_and_point_distance():
    line = east_line(100)
    assert line_length_m(line) == pytest.approx(100, abs=0.5)
    mid = sample_along(line, 50)[1]
    assert point_line_distance_m((mid[0], mid[1]), line) == pytest.approx(0, abs=0.5)


def test_plane_grade():
    mean, mx = edge_grade(east_line(100), Plane(6.0))
    assert mx == pytest.approx(6.0, abs=0.3)
    assert mean == pytest.approx(6.0, abs=0.3)


def test_short_edge_grade_is_damped():
    # 5 m line with 1 m rise -> 1/30*100
    mean, mx = edge_grade(east_line(5), Plane(20.0))
    assert mx == pytest.approx(100 / 30, abs=0.2)
    assert mean == pytest.approx(100 / 30, abs=0.2)


def test_nodata_becomes_none():
    a = CopernicusDEM._clean_array([-32767.0, float("nan"), 12.0], None)
    assert np.isnan(a[:2]).all() and a[2] == 12.0
    b = CopernicusDEM._clean_array([-9999.0, 5.0], -9999.0)
    assert np.isnan(b[0]) and b[1] == 5.0


def test_all_none_returns_none():
    assert edge_grade(east_line(100), Holes(all=True)) == (None, None)


def test_partial_holes_skip_windows():
    line = east_line(100)
    lon_mid = sample_along(line, 50)[1][0]
    mean, mx = edge_grade(line, Holes(lon_min=lon_mid - 1e-5, lon_max=lon_mid + 1e-5))
    assert mean is not None and mx == pytest.approx(0.0, abs=1e-9)


def test_profile():
    p = profile(east_line(100), Plane(5.0), step_m=25.0)
    assert [round(d) for d, _ in p] == [0, 25, 50, 75, 100]
    assert p[-1][1] == pytest.approx(5.0, abs=0.3)


# ---- download integrity / retry (no network) ----
import io
import urllib.error
import urllib.request

import numpy as np
import rasterio
from rasterio.transform import from_origin

BBOX = (2.1, 48.1, 2.2, 48.2)
TILE = "Copernicus_DSM_COG_10_N48_00_E002_00_DEM.tif"


@pytest.fixture(scope="module")
def tif_bytes(tmp_path_factory):
    p = tmp_path_factory.mktemp("t") / "t.tif"
    with rasterio.open(p, "w", driver="GTiff", height=64, width=64, count=1,
                       dtype="float32", crs="EPSG:4326",
                       transform=from_origin(2, 49, 1 / 64, 1 / 64)) as ds:
        ds.write(np.full((64, 64), 40.0, dtype="float32"), 1)
    return p.read_bytes()


class FakeResp:
    def __init__(self, body, headers, status):
        self._b, self.headers, self.status = io.BytesIO(body), headers, status

    def read(self, n=-1):
        return self._b.read(n)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def fake_server(monkeypatch, data, cut_fractions=(), notfound=False):
    """Serves `data`; the i-th request delivers only cut_fractions[i] of the body."""
    calls = []

    def urlopen(req, timeout=None):
        i = len(calls)
        calls.append(req.headers.get("Range"))
        if notfound:
            raise urllib.error.HTTPError(req.full_url, 404, "nf", {}, None)
        rng = req.headers.get("Range")
        start = int(rng.split("=")[1].rstrip("-")) if rng else 0
        body = data[start:]
        frac = cut_fractions[i] if i < len(cut_fractions) else 1.0
        sent = body[: int(len(body) * frac)]
        if rng:
            h = {"Content-Range": f"bytes {start}-{len(data) - 1}/{len(data)}",
                 "Content-Length": str(len(body))}
            return FakeResp(sent, h, 206)
        return FakeResp(sent, {"Content-Length": str(len(body))}, 200)

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    return calls


def test_404_marks_tile_missing(tmp_path, monkeypatch):
    fake_server(monkeypatch, b"", notfound=True)
    dem = CopernicusDEM(BBOX, tmp_path)
    assert dem.elevations([(2.15, 48.15)]) == [None]
    assert list((tmp_path / "dem").iterdir()) == []


def test_short_read_then_resume(tmp_path, monkeypatch, tif_bytes):
    calls = fake_server(monkeypatch, tif_bytes, cut_fractions=(0.5,))
    dem = CopernicusDEM(BBOX, tmp_path)
    assert calls[0] is None and calls[1].startswith("bytes=")
    assert (tmp_path / "dem" / TILE).read_bytes() == tif_bytes
    assert [f.name for f in (tmp_path / "dem").iterdir()] == [TILE]
    assert dem.elevations([(2.01, 48.99)]) == [pytest.approx(40.0)]


def test_all_attempts_short_raises(tmp_path, monkeypatch, tif_bytes):
    fake_server(monkeypatch, tif_bytes, cut_fractions=(0.5, 0.5, 0.5))
    with pytest.raises(OSError):
        CopernicusDEM(BBOX, tmp_path)
    assert not (tmp_path / "dem" / TILE).exists()


def test_corrupt_cached_tile_is_evicted(tmp_path, monkeypatch, tif_bytes):
    (tmp_path / "dem").mkdir()
    (tmp_path / "dem" / TILE).write_bytes(b"garbage")
    fake_server(monkeypatch, tif_bytes)
    dem = CopernicusDEM(BBOX, tmp_path)
    assert (tmp_path / "dem" / TILE).read_bytes() == tif_bytes
    assert dem.elevations([(2.01, 48.99)]) == [pytest.approx(40.0)]


def test_terrain_correct_removes_building_spike():
    arr = np.full((20, 20), 100.0)
    arr[8:11, 8:11] = 130.0
    out = terrain_correct(arr, None)
    assert out[9, 9] == pytest.approx(100.0, abs=1.0)


def test_terrain_correct_keeps_slope():
    arr = np.tile(np.arange(20, dtype=float) * 3.0, (20, 1))
    out = terrain_correct(arr, None)
    assert np.nanmean(np.diff(out[10, 5:15])) == pytest.approx(3.0, abs=0.3)


def test_terrain_correct_preserves_nodata():
    arr = np.full((10, 10), 50.0)
    arr[0, 0] = -32767.0
    out = terrain_correct(arr, -32767.0)
    assert np.isnan(out[0, 0]) and out[5, 5] == pytest.approx(50.0)


# 10x10 tile, 0.001 deg pixels, upper-left corner at (10.0, 50.0); value = 10 * col
TF = Affine(0.001, 0, 10.0, 0, -0.001, 50.0)


def _slope_arr():
    return np.tile(np.arange(10, dtype=float) * 10.0, (10, 1))


def test_bilinear_sampling_between_pixels():
    arr = _slope_arr()
    # centres of cols 3 and 4 are at lon 10.0035 / 10.0045; row 5 centre lat = 49.9945
    v = sample_bilinear(arr, TF, [(10.004, 49.9945), (10.0035, 49.9945)])
    assert v[0] == pytest.approx(35.0)
    assert v[1] == pytest.approx(30.0)


def test_bilinear_none_near_nodata():
    arr = _slope_arr()
    arr[5, 4] = np.nan
    v = sample_bilinear(arr, TF, [(10.004, 49.9945), (10.0085, 49.9945)])
    assert v[0] is None
    assert v[1] == pytest.approx(80.0)
