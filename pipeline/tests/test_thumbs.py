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


def _img():
    from PIL import Image
    # noisy image so that the encoded size depends on quality and size
    import random
    rnd = random.Random(1)
    img = Image.new("RGB", (WIDTH, HEIGHT))
    img.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)) for _ in range(WIDTH * HEIGHT)])
    return img


def test_fit_webp_shrinks_the_image_when_quality_is_not_enough():
    from PIL import Image
    from happywheel.thumbs import QUALITIES, encode_webp, fit_webp

    img = _img()
    full_lowest = len(encode_webp(img, QUALITIES[-1]))
    small = len(encode_webp(img, QUALITIES[-1], 0.9))
    assert small < full_lowest
    data = fit_webp(img, max_bytes=small)
    assert len(data) <= small
    assert Image.open(io.BytesIO(data)).size == (round(WIDTH * 0.9), round(HEIGHT * 0.9))


def test_fit_webp_raises_when_even_the_smallest_is_too_big():
    from happywheel.thumbs import ThumbTooLarge, fit_webp

    with pytest.raises(ThumbTooLarge):
        fit_webp(_img(), max_bytes=200)
    with pytest.raises(ThumbTooLarge):
        render_thumb(_fc(), max_bytes=10)


def test_thumbs_cli_fails_when_the_thumbnail_is_too_big(tmp_path, monkeypatch):
    import happywheel.thumbs as thumbs

    d = tmp_path / "lucerne"
    d.mkdir()
    (d / "segments.geojson").write_text(json.dumps(_fc()), encoding="utf-8")
    monkeypatch.setattr(thumbs, "MAX_BYTES", 10)
    assert main(["thumbs", "--out", str(tmp_path)]) == 1
    assert not (d / "thumb.webp").exists()
