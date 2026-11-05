"""Accessibility penalty and score rules (design section 3.4).

Pure functions only. Tag values may arrive as str, list[str] (osmnx merges
duplicate tags into lists) or None.
"""

from __future__ import annotations

from typing import Literal

SurfaceClass = Literal["smooth", "paving", "compacted", "cobble", "unpaved", "unknown"]

DEFAULT_WEIGHTS: dict[str, float] = {"slope": 1.0, "surface": 0.8, "kerb": 0.6, "uncertainty": 0.3}

_SURFACE_TAG_CLASS: dict[str, SurfaceClass] = {
    "asphalt": "smooth",
    "concrete": "smooth",
    "concrete:plates": "smooth",
    "paved": "smooth",
    "metal": "smooth",
    "wood": "smooth",
    "paving_stones": "paving",
    "bricks": "paving",
    "compacted": "compacted",
    "fine_gravel": "compacted",
    "sett": "cobble",
    "cobblestone": "cobble",
    "unhewn_cobblestone": "cobble",
    "gravel": "unpaved",
    "unpaved": "unpaved",
    "grass": "unpaved",
    "dirt": "unpaved",
    "ground": "unpaved",
    "sand": "unpaved",
    "pebblestone": "unpaved",
}

# Worst-last ordering used when a list of surface classes is reduced.
_SURFACE_ORDER: list[str] = ["smooth", "paving", "compacted", "cobble", "unpaved"]

_SURFACE_BASE_PENALTY: dict[str, float] = {
    "smooth": 0,
    "paving": 20,
    "compacted": 40,
    "cobble": 70,
    "unpaved": 90,
    "unknown": 0,
}

_BAD_SMOOTHNESS = {"bad", "very_bad", "horrible", "very_horrible", "impassable"}


def _as_list(value: str | list[str] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return list(value)


def worst(value: str | list[str] | None, order: list[str]) -> str | None:
    """Return the element of `value` that ranks worst (latest in `order`).

    Elements not present in `order` are ignored. Returns None when nothing
    in `value` is ranked.
    """
    ranked = [v for v in _as_list(value) if v in order]
    if not ranked:
        return None
    return max(ranked, key=order.index)


def surface_class(surface: str | list[str] | None) -> SurfaceClass:
    classes = [_SURFACE_TAG_CLASS.get(s, "unknown") for s in _as_list(surface)]
    result = worst(classes, _SURFACE_ORDER)
    if result is None:
        return "unknown"
    return result  # type: ignore[return-value]


def surface_penalty(cls: SurfaceClass, smoothness: str | list[str] | None) -> float:
    penalty = float(_SURFACE_BASE_PENALTY[cls])
    if any(s in _BAD_SMOOTHNESS for s in _as_list(smoothness)):
        penalty += 20
    return min(penalty, 100.0)


def slope_penalty(grade_max_pct: float | None) -> float:
    if grade_max_pct is None:
        return 0.0
    g = abs(grade_max_pct)
    if g < 5:
        return 0.0
    if g < 8.33:
        return (g - 5) / 3.33 * 50
    if g < 12:
        return 50 + (g - 8.33) / 3.67 * 50
    return 100.0


def kerb_penalty(kerbs: list[str | None]) -> float:
    return 60.0 if "raised" in kerbs else 0.0


def uncertainty_penalty(cls: SurfaceClass, grade_max_pct: float | None) -> float:
    penalty = 0.0
    if cls == "unknown":
        penalty += 15
    if grade_max_pct is None:
        penalty += 15
    return penalty


def _has(value: str | list[str] | None, target: str) -> bool:
    return target in _as_list(value)


def is_steps(tags: dict) -> bool:
    return _has(tags.get("highway"), "steps")


def is_blocked(tags: dict) -> bool:
    if is_steps(tags):
        if not (_has(tags.get("ramp"), "yes") or _has(tags.get("wheelchair"), "yes")):
            return True
    return _has(tags.get("wheelchair"), "no")


def segment_score(p: dict[str, float], weights: dict[str, float], wc_yes: bool) -> float:
    total = sum(weights[k] * p[k] for k in ("slope", "surface", "kerb", "uncertainty"))
    score = min(max(100 - total, 0.0), 100.0)
    if wc_yes:
        score = min(score + 10, 100.0)
    return score
