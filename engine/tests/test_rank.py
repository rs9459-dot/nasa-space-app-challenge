"""Choosing the 3 options (A6). Outcomes here are hand-made so each rule is easy to see."""
from __future__ import annotations

import numpy as np
import pytest

from engine import bundle, contract, rank
from engine.tests.conftest import FIELD_ID
from engine.types import Outcomes

EVEN = {"water": 0.34, "income": 0.33, "drought": 0.33}


def outcomes(rows: list[tuple[tuple[str, str, str], float, list[float], float]]) -> Outcomes:
    """rows: (rotation, water AF, incomes across sequences, soil score)."""
    return Outcomes(
        rotations=[r[0] for r in rows],
        yield_frac=np.ones((len(rows), len(rows[0][2]), 3)),
        income_usd=np.array([r[2] for r in rows], dtype=float),
        water_af=np.array([[r[1]] * len(r[2]) for r in rows], dtype=float),
        soil_score=np.array([r[3] for r in rows], dtype=float),
    )


THIRSTY = (("alfalfa", "alfalfa", "wheat"), 4.8, [1200, 1100, 1000, 900, 100], 6)   # most income, bad in drought
FRUGAL = (("sorghum", "safflower", "barley"), 2.0, [600, 600, 600, 600, 500], 7)    # least water
STEADY = (("barley", "sorghum", "cover_crop"), 3.0, [700, 700, 700, 700, 690], 8)   # best bad year
POOR = (("corn", "corn", "wheat"), 5.0, [300, 300, 300, 300, 0], 3)                 # worse on everything
BASE = outcomes([(("alfalfa", "alfalfa", "alfalfa"), 5.21, [900, 900, 900, 900, 400], 5)])


@pytest.fixture
def field(data_root):
    return bundle.load_field(FIELD_ID)


def test_weights_follow_priorities_and_keep_soil():
    w = rank.weights({"water": 1, "income": 0, "drought": 0})
    assert w.tolist() == pytest.approx([0.9, 0, 0, 0.1]) and w.sum() == pytest.approx(1)
    assert rank.weights({"water": 0, "income": 0, "drought": 0}).tolist() == pytest.approx([0.3, 0.3, 0.3, 0.1])


def test_topsis_puts_the_dominant_row_first():
    matrix = np.array([[1.0, 10, 10, 9], [5.0, 1, 1, 1], [3.0, 5, 5, 5]])  # water, income, bad year, soil
    closeness = rank.topsis(matrix, rank.weights(EVEN), [False, True, True, True])
    assert closeness[0] == pytest.approx(1) and closeness[1] == pytest.approx(0)
    assert closeness[0] > closeness[2] > closeness[1]


def test_each_label_gets_the_right_rotation(field):
    result = rank.choose(outcomes([THIRSTY, FRUGAL, STEADY, POOR]), BASE, EVEN, field)
    by_label = {o["label"]: o for o in result["options"]}
    assert by_label["most_water_saved"]["rotation"] == list(FRUGAL[0])
    assert by_label["most_income"]["rotation"] == list(THIRSTY[0])
    assert by_label["safest_in_drought"]["rotation"] == list(STEADY[0])
    assert [o["rank"] for o in result["options"]] == [1, 2, 3]
    assert contract.problems(result) == []


def test_numbers_are_rounded_for_the_farmer(field):
    result = rank.choose(outcomes([THIRSTY, FRUGAL, STEADY]), BASE, EVEN, field)
    assert result["baseline"] == {"water_af_per_acre": 5.2, "income_usd_per_acre": 800, "bad_year_income_usd_per_acre": 600}
    frugal = result["options"][0]
    assert frugal["water_af_per_acre"] == 2.0
    assert frugal["water_saved_pct"] == 62          # (5.2 - 2.0) / 5.2
    assert frugal["income_usd_per_acre"] == 580 and frugal["bad_year_income_usd_per_acre"] == 540
    assert frugal["soil_score"] == 7
    thirsty = result["options"][1]
    assert thirsty["bad_year_income_usd_per_acre"] == 420  # 10th percentile of its incomes


def test_the_same_rotation_is_never_offered_twice(field):
    # FRUGAL is also the best in a bad year here; the drought label must take the next best.
    frugal_and_safe = (FRUGAL[0], 2.0, [800, 800, 800, 800, 790], 7)
    result = rank.choose(outcomes([THIRSTY, frugal_and_safe, STEADY]), BASE, EVEN, field)
    rotations = [tuple(o["rotation"]) for o in result["options"]]
    assert len(set(rotations)) == 3
    assert rotations[0] == FRUGAL[0] and rotations[2] == STEADY[0]


def test_an_option_can_use_more_water_than_now(field):
    low_base = outcomes([(("barley", "barley", "barley"), 2.5, [500] * 5, 5)])
    result = rank.choose(outcomes([THIRSTY, FRUGAL, STEADY]), low_base, EVEN, field)
    assert result["options"][1]["water_saved_pct"] == -92  # 4.8 vs 2.5
    assert contract.problems(result) == []


def test_fallow_baseline_does_not_divide_by_zero(field):
    idle = outcomes([(("fallow", "fallow", "fallow"), 0.0, [0] * 5, 2)])
    result = rank.choose(outcomes([THIRSTY, FRUGAL, STEADY]), idle, EVEN, field)
    assert all(o["water_saved_pct"] == 0 for o in result["options"])


def test_fewer_than_three_rotations_is_refused(field):
    with pytest.raises(bundle.BundleError, match="3 are needed"):
        rank.choose(outcomes([THIRSTY, FRUGAL]), BASE, EVEN, field)


def test_rotations_without_an_income_estimate_are_never_offered(field):
    unknown = (("barley", "barley", "fallow"), 0.5, [float("nan")] * 5, 9.0)
    result = rank.choose(outcomes([THIRSTY, FRUGAL, STEADY, unknown]), BASE, EVEN, field)
    assert ["barley", "barley", "fallow"] not in [o["rotation"] for o in result["options"]]


def test_farmer_crop_without_an_estimate_is_reported_as_unavailable(field):
    base = outcomes([(("barley",) * 3, 3.0, [float("nan")] * 5, 5.0)])
    result = rank.choose(outcomes([THIRSTY, FRUGAL, STEADY]), base, EVEN, field)
    assert result["baseline"]["income_usd_per_acre"] is None
    assert result["baseline"]["bad_year_income_usd_per_acre"] is None
    assert contract.problems(result) == []


def test_result_carries_sources_years_and_sample_flag(field):
    result = rank.choose(outcomes([THIRSTY, FRUGAL, STEADY]), BASE, EVEN, field, sources=["NASA POWER", "NASA POWER", "SMAP"])
    assert result["data_sources"] == ["NASA POWER", "SMAP"]
    assert result["years_tested"] == 2 and result["sample_data"] is True
    assert result["field"]["current_rotation"] == ["alfalfa"] * 3
