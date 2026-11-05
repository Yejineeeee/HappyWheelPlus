"""City thumbnails: a small heatmap of segment scores for the city cards on the home screen.

The output is deterministic for the same input (fixed figure size and dpi, no metadata),
so re-running does not create a diff unless the data changed.
"""
from __future__ import annotations

import io
import json
import math
from pathlib import Path

# same palette as the web app (web/src/map/style.ts SCORE_STOPS)
SCORE_STOPS: list[tuple[float, str]] = [
    (0, "#440154"),
    (30, "#414487"),
    (55, "#2a788e"),
    (80, "#22a884"),
    (100, "#7ad151"),
]
BLOCKED = "#9aa1ab"
UNKNOWN = "#b8bec6"
BACKGROUND = "#f4f5f7"

WIDTH, HEIGHT, DPI = 480, 320, 100
MAX_BYTES = 60 * 1024
PAD = 0.04  # share cut from each edge so the frame is filled with streets


def _rgb(h: str) -> tuple[float, float, float]:
    return tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))  # type: ignore[return-value]


def score_rgb(score: float | None) -> tuple[float, float, float]:
    """Linear interpolation between SCORE_STOPS; None -> unknown grey."""
    if score is None or score < 0:
        return _rgb(UNKNOWN)
    s = max(0.0, min(100.0, float(score)))
    for (v0, c0), (v1, c1) in zip(SCORE_STOPS, SCORE_STOPS[1:]):
        if s <= v1:
            t = (s - v0) / (v1 - v0)
            a, b = _rgb(c0), _rgb(c1)
            return tuple(round((x + (y - x) * t) * 255) / 255 for x, y in zip(a, b))  # type: ignore[return-value]
    return _rgb(SCORE_STOPS[-1][1])


def _frame(xs: list[float], ys: list[float]) -> tuple[float, float, float, float]:
    """Bounds cropped to the WIDTH:HEIGHT aspect (cover: the frame is filled, the longer side is cut)."""
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, h = max(x1 - x0, 1e-9), max(y1 - y0, 1e-9)
    aspect = WIDTH / HEIGHT
    if w / h > aspect:
        w = h * aspect
    else:
        h = w / aspect
    w *= 1 - 2 * PAD
    h *= 1 - 2 * PAD
    return cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2


def render_thumb(fc: dict) -> bytes:
    """Render a segments FeatureCollection to WebP bytes (WIDTH x HEIGHT, <= MAX_BYTES)."""
    from matplotlib.collections import LineCollection
    from matplotlib.figure import Figure
    from PIL import Image

    feats = [f for f in fc.get("features", []) if len(f["geometry"]["coordinates"]) > 1]
    lat0 = 0.0
    if feats:
        lats = [c[1] for f in feats for c in f["geometry"]["coordinates"]]
        lat0 = (min(lats) + max(lats)) / 2
    kx = math.cos(math.radians(lat0))

    def xy(coords):
        return [(lon * kx, lat) for lon, lat in coords]

    # good segments first so that the hard ones end up on top and stay visible
    def order(f):
        p = f["properties"]
        s = p.get("score")
        return -1.0 if p.get("blocked") else (101.0 if s is None else -float(s))

    fig = Figure(figsize=(WIDTH / DPI, HEIGHT / DPI), dpi=DPI, facecolor=BACKGROUND)
    ax = fig.add_axes((0, 0, 1, 1))
    ax.set_axis_off()
    ax.set_facecolor(BACKGROUND)
    if feats:
        feats = sorted(feats, key=order, reverse=True)
        lines = [xy(f["geometry"]["coordinates"]) for f in feats]
        colors = [_rgb(BLOCKED) if f["properties"].get("blocked") else score_rgb(f["properties"].get("score"))
                  for f in feats]
        ax.add_collection(LineCollection(lines, colors=colors, linewidths=0.7, capstyle="round"))
        xs = [p[0] for ln in lines for p in ln]
        ys = [p[1] for ln in lines for p in ln]
        x0, x1, y0, y1 = _frame(xs, ys)
        ax.set_xlim(x0, x1)
        ax.set_ylim(y0, y1)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=DPI, facecolor=BACKGROUND, metadata={"Software": None})
    img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    if img.size != (WIDTH, HEIGHT):
        img = img.resize((WIDTH, HEIGHT))
    for quality in (82, 74, 66, 58, 50, 40):
        out = io.BytesIO()
        img.save(out, format="WEBP", quality=quality, method=6)
        data = out.getvalue()
        if len(data) <= MAX_BYTES:
            return data
    return data


def write_thumb(city_dir: Path) -> int:
    """Read city_dir/segments.geojson and write city_dir/thumb.webp. Returns byte size."""
    fc = json.loads((Path(city_dir) / "segments.geojson").read_text(encoding="utf-8"))
    data = render_thumb(fc)
    (Path(city_dir) / "thumb.webp").write_bytes(data)
    return len(data)
