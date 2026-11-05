import pytest

from happywheel.scoring import (
    DEFAULT_WEIGHTS,
    is_blocked,
    is_steps,
    kerb_penalty,
    segment_score,
    slope_penalty,
    surface_class,
    surface_penalty,
    uncertainty_penalty,
    worst,
)


@pytest.mark.parametrize("g,exp", [(None, 0), (0, 0), (4.99, 0), (5, 0), (8.33, 50), (-8.33, 50), (12, 100), (20, 100)])
def test_slope_penalty_boundaries(g, exp):
    assert slope_penalty(g) == pytest.approx(exp, abs=0.1)


def test_slope_penalty_midpoint():
    assert slope_penalty(6.665) == pytest.approx(25, abs=0.1)


@pytest.mark.parametrize(
    "s,cls",
    [
        ("asphalt", "smooth"),
        ("sett", "cobble"),
        ("paving_stones", "paving"),
        ("gravel", "unpaved"),
        (None, "unknown"),
        ("weird", "unknown"),
    ],
)
def test_surface_class(s, cls):
    assert surface_class(s) == cls


def test_list_tags_take_worst():
    assert surface_class(["asphalt", "sett"]) == "cobble"
    assert surface_class(["unknown_value", "paving_stones"]) == "paving"
    assert surface_class(["unknown_value", "weird"]) == "unknown"
    assert is_steps({"highway": ["footway", "steps"]})


def test_worst_helper():
    order = ["a", "b", "c"]
    assert worst(["a", "c", "x"], order) == "c"
    assert worst("b", order) == "b"
    assert worst("x", order) is None
    assert worst(None, order) is None


def test_smoothness_adds_20_capped():
    assert surface_penalty("unpaved", "horrible") == 100
    assert surface_penalty("paving", "bad") == 40


def test_smoothness_list_any_bad_element():
    assert surface_penalty("paving", ["good", "bad"]) == 40
    assert surface_penalty("paving", ["good", "excellent"]) == 20


def test_steps_blocked_unless_ramp():
    assert is_blocked({"highway": "steps"})
    assert not is_blocked({"highway": "steps", "ramp": "yes"})
    assert is_blocked({"highway": "footway", "wheelchair": "no"})


def test_steps_wheelchair_yes_exempts_when_any_element_yes():
    assert not is_blocked({"highway": "steps", "wheelchair": "yes"})
    assert not is_blocked({"highway": ["footway", "steps"], "ramp": ["no", "yes"]})
    assert is_blocked({"highway": "steps", "ramp": ["no", "unknown"]})


def test_wheelchair_no_list_blocks():
    assert is_blocked({"highway": "footway", "wheelchair": ["limited", "no"]})


def test_kerb():
    assert kerb_penalty([None, "raised"]) == 60
    assert kerb_penalty(["lowered", "flush"]) == 0


def test_uncertainty_penalty():
    assert uncertainty_penalty("smooth", 3) == 0
    assert uncertainty_penalty("unknown", 3) == 15
    assert uncertainty_penalty("smooth", None) == 15
    assert uncertainty_penalty("unknown", None) == 30


def test_score_default_weights():
    p = {"slope": 50, "surface": 70, "kerb": 0, "uncertainty": 0}
    assert segment_score(p, DEFAULT_WEIGHTS, False) == 0  # 100-50-56 < 0 -> 0


def test_score_partial():
    p = {"slope": 20, "surface": 20, "kerb": 0, "uncertainty": 15}
    assert segment_score(p, DEFAULT_WEIGHTS, False) == pytest.approx(59.5)


def test_score_bonus_capped():
    p = {"slope": 0, "surface": 0, "kerb": 0, "uncertainty": 0}
    assert segment_score(p, DEFAULT_WEIGHTS, True) == 100


def test_score_bonus_applied_after_clamp():
    p = {"slope": 50, "surface": 70, "kerb": 0, "uncertainty": 0}
    assert segment_score(p, DEFAULT_WEIGHTS, True) == 10


def test_default_weights_values():
    assert DEFAULT_WEIGHTS == {"slope": 1.0, "surface": 0.8, "kerb": 0.6, "uncertainty": 0.3}
