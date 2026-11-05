import pytest
from fixtures import Holes, Plane

from happywheel.elevation import CopernicusDEM, edge_grade, profile, tile_name
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
    assert CopernicusDEM._clean([-32767.0, float("nan"), 12.0]) == [None, None, 12.0]
    assert CopernicusDEM._clean([-9999.0, 5.0], nodata=-9999.0) == [None, 5.0]


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
