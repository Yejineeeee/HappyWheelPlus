import io
import json

import pytest

pytest.importorskip("matplotlib")
PIL = pytest.importorskip("PIL")

from happywheel.__main__ import main  # noqa: E402
from happywheel.thumbs import HEIGHT, MAX_BYTES, WIDTH, render_thumb, score_rgb  # noqa: E402


def _fc():
    feats = []
    for i, score in enumerate([100.0, 80.0, 55.0, 30.0, 0.0, None]):
        y = 47.05 + i * 0.001
        feats.append({
            "type": "Feature", "id": i,
            "geometry": {"type": "LineString", "coordinates": [[8.30, y], [8.31, y + 0.0005]]},
            "properties": {"score": score, "blocked": False},
        })
    feats.append({
        "type": "Feature", "id": 6,
        "geometry": {"type": "LineString", "coordinates": [[8.30, 47.05], [8.31, 47.056]]},
        "properties": {"score": None, "blocked": True},
    })
    return {"type": "FeatureCollection", "features": feats}


def test_score_rgb_matches_stops():
    assert score_rgb(0) == pytest.approx((0x44 / 255, 0x01 / 255, 0x54 / 255))
    assert score_rgb(100) == pytest.approx((0x7A / 255, 0xD1 / 255, 0x51 / 255))
    assert score_rgb(None) != score_rgb(100)


def test_render_thumb_size_and_determinism():
    a = render_thumb(_fc())
    b = render_thumb(_fc())
    assert a == b
    assert len(a) <= MAX_BYTES
    from PIL import Image
    img = Image.open(io.BytesIO(a))
    assert img.format == "WEBP"
    assert img.size == (WIDTH, HEIGHT)


def test_render_thumb_empty_collection():
    data = render_thumb({"type": "FeatureCollection", "features": []})
    assert 0 < len(data) <= MAX_BYTES


def test_thumbs_cli_writes_file(tmp_path):
    d = tmp_path / "lucerne"
    d.mkdir()
    (d / "segments.geojson").write_text(json.dumps(_fc()), encoding="utf-8")
    (tmp_path / "other").mkdir()  # no segments: skipped
    assert main(["thumbs", "--out", str(tmp_path)]) == 0
    assert (d / "thumb.webp").stat().st_size <= MAX_BYTES
    assert not (tmp_path / "other" / "thumb.webp").exists()
    assert main(["thumbs", "--out", str(tmp_path), "--city", "seoul"]) == 2
