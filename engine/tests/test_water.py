"""The water balance (A5). Crop values here are TEST values from conftest, not crop science."""
from __future__ import annotations

import io
import time
from itertools import product
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from engine import bundle, water
from engine.bundle import BundleError
from engine.tests.conftest import FIELD_ID, TEST_CROPS_CSV
from engine.types import Reference, Signals

ALF = ("alfalfa", "alfalfa", "alfalfa")
BAR = ("barley", "barley", "barley")
FALLOW = ("fallow", "fallow", "fallow")


@pytest.fixture
def loaded(data_root):
    return bundle.load(FIELD_ID)


# --- physics --------------------------------------------------------------------------------

def test_extraterrestrial_radiation_matches_fao56_example_8():
    # FAO-56 example 8: 20 deg S on 3 September (day 246) -> Ra = 32.2 MJ/m2/day
    assert water.extraterrestrial_radiation(-20.0, np.array([246]))[0] == pytest.approx(32.2, abs=0.1)


def test_hargreaves_matches_a_hand_calculation():
    ra = water.extraterrestrial_radiation(39.38, np.array([196]))[0]
    expected = 0.0023 * 0.408 * ra * (25 + 17.8) * np.sqrt(35 - 15)
    got = water.hargreaves_et0(39.38, np.array([196]), np.array([35.0]), np.array([15.0]), np.array([25.0]))[0]
    assert got == pytest.approx(expected) and 6 < got < 9  # a hot July day in the desert


def test_kc_curve_follows_the_four_stages(loaded):
    kc, season = water.kc_curve(loaded[1].crops.loc["barley"])
    start = pd.Timestamp(2001, 3, 15).day_of_year - 1
    assert season.sum() == 130 and season[start] and not season[start - 1]
    assert kc[start] == 0.3 and kc[start + 19] == 0.3          # initial
    assert 0.3 < kc[start + 35] < 1.1                          # development
    assert kc[start + 60] == 1.1                               # mid-season
    assert kc[start + 129] == pytest.approx(0.3)               # end of late season
    assert not water.kc_curve(loaded[1].crops.loc["fallow"])[1].any()


# --- behaviour ------------------------------------------------------------------------------

def test_shapes_and_sequences(loaded):
    field, ref = loaded
    r = water.simulate(field, [ALF, BAR], ref)
    # 2 weather years x 2 sourced allocation years = 4 sequences
    assert r.etc_mm.shape == r.eta_mm.shape == r.irrigation_mm.shape == (2, 4, 3)
    assert r.sequences.tolist() == [[2001, 2002, 2001], [2001, 2002, 2001], [2002, 2001, 2002], [2002, 2001, 2002]]
    assert r.allocation.tolist() == [[1.0, 0.5, 1.0], [0.5, 1.0, 0.5]] * 2
    assert r.allocation_years.tolist() == [[2001, 2002, 2001], [2002, 2001, 2002]] * 2
    assert (r.eta_mm <= r.etc_mm + 1e-9).all() and (r.eta_mm >= 0).all()


def test_plenty_of_water_means_no_stress(loaded):
    field, ref = loaded
    field.water["full_allocation_af_per_acre"] = 20.0
    r = water.simulate(field, [ALF], ref)
    assert r.eta_mm == pytest.approx(r.etc_mm)
    assert 700 < r.etc_mm.mean() < 1500  # mm a year for a full-season crop on this fake weather


def test_a_water_cut_lowers_water_use(loaded):
    field, ref = loaded
    full = water.simulate(field, [ALF], ref, allocation={2001: 1.0})
    cut = water.simulate(field, [ALF], ref, allocation={2001: 0.3})
    assert cut.eta_mm.sum() < full.eta_mm.sum() * 0.8
    assert cut.irrigation_mm.sum() < full.irrigation_mm.sum()
    assert cut.etc_mm == pytest.approx(full.etc_mm)  # the need does not change, only what is met


def test_irrigation_never_exceeds_the_allocation(loaded):
    field, ref = loaded
    r = water.simulate(field, [ALF, BAR], ref)
    cap = 3.5 * r.allocation * water.MM_PER_AF_PER_ACRE  # (S, 3)
    assert (r.irrigation_mm <= cap[None] + 1e-6).all()
    assert (r.irrigation_mm[0] > 0).all()


def test_application_efficiency_means_more_water_delivered(loaded):
    field, ref = loaded
    field.water["full_allocation_af_per_acre"] = 20.0
    lossless = water.simulate(field, [BAR], ref)
    field.water["application_efficiency"] = 0.8
    lossy = water.simulate(field, [BAR], ref)
    assert lossy.eta_mm == pytest.approx(lossless.eta_mm)
    assert lossy.irrigation_mm == pytest.approx(lossless.irrigation_mm / 0.8)


def test_fallow_uses_no_irrigation(loaded):
    field, ref = loaded
    r = water.simulate(field, [FALLOW], ref)
    assert r.irrigation_mm.sum() == 0 and r.etc_mm.sum() == 0 and r.eta_mm.sum() == 0


def test_a_dry_start_needs_more_irrigation(loaded):
    field, ref = loaded
    wet = water.simulate(field, [BAR], ref, Signals())
    dry = water.simulate(field, [BAR], ref, Signals(start_depletion_frac=1.0))
    assert dry.irrigation_mm[:, :, 0].sum() > wet.irrigation_mm[:, :, 0].sum()


def test_more_rain_means_less_irrigation(loaded):
    field, ref = loaded
    normal = water.simulate(field, [BAR], ref, Signals())
    rainy = water.simulate(field, [BAR], ref, Signals(rain_scale=5.0))
    assert rainy.irrigation_mm.sum() < normal.irrigation_mm.sum()


def test_weather_override_is_used(loaded):
    field, ref = loaded
    hot = field.weather.copy()
    hot[["tmax_c", "tmean_c"]] += 5
    assert water.simulate(field, [BAR], ref, weather=hot).etc_mm.sum() > water.simulate(field, [BAR], ref).etc_mm.sum()


# --- missing data fails loudly --------------------------------------------------------------

def test_missing_crop_values_are_named(loaded):
    field, ref = loaded
    with pytest.raises(BundleError, match="no row for 'quinoa'") as err:
        water.simulate(field, [("quinoa", "barley", "barley")], ref)
    assert err.value.code == "no_data"
    ref.crops.loc["barley", "kc_mid"] = np.nan
    with pytest.raises(BundleError, match="'barley' has no value for kc_mid"):
        water.simulate(field, [BAR], ref)
    with pytest.raises(BundleError, match="missing columns p_depletion"):
        water.simulate(field, [BAR], Reference(crops=ref.crops.drop(columns=["p_depletion"]), economics=ref.economics))


def test_missing_water_data_is_named(loaded):
    field, ref = loaded
    field.water = {}
    with pytest.raises(BundleError, match="full_allocation_af_per_acre"):
        water.simulate(field, [BAR], ref)
    field.water = {"full_allocation_af_per_acre": 3.5}
    with pytest.raises(BundleError, match="allocation_fraction_by_year"):
        water.simulate(field, [BAR], ref)


# --- real Fallon weather, soil and water (crop values still TEST) --------------------------

FALLON = Path(__file__).resolve().parents[2] / "data" / "fields" / "nv-fallon-01"
needs_fallon = pytest.mark.skipif(not (FALLON / "water.json").exists(), reason="Fallon water-slice data not fetched")


@pytest.fixture
def fallon():
    import json
    from engine.types import Field
    weather = bundle._load_weather(FALLON / "weather_daily.csv", "nv-fallon-01", "real")
    field = Field("nv-fallon-01", "Fallon", "Fallon, NV", 39.38, -118.77, "US", "real", weather,
                  json.loads((FALLON / "soil.json").read_text()), json.loads((FALLON / "water.json").read_text()), [], {}, [])
    crops = pd.read_csv(io.StringIO(TEST_CROPS_CSV)).set_index("crop")
    return field, Reference(crops=crops, economics=pd.DataFrame())


@needs_fallon
def test_fallon_reference_et_is_a_desert(fallon):
    field, _ = fallon
    years, et0, rain = water.yearly_arrays(field.weather, field.lat)
    assert len(years) == 25
    annual = et0.sum(axis=1)
    assert 1100 < annual.min() and annual.max() < 1600   # mm/yr; far more than the 78-307 mm of rain
    assert et0[:, 180:210].mean() > 3 * et0[:, :30].mean()  # July vs January


@needs_fallon
def test_fallon_drought_allocation_bites(fallon):
    field, ref = fallon
    r = water.simulate(field, [ALF], ref)
    assert r.eta_mm.shape == (1, 25 * 11, 3)
    met = (r.eta_mm / r.etc_mm)[0]                       # share of the need that was met
    by_alloc = {a: met[r.allocation == a].mean() for a in (0.2, 1.0)}
    assert by_alloc[0.2] < by_alloc[1.0] - 0.3           # the 2015 allocation (20%) hurts badly
    assert (r.irrigation_mm <= 3.5 * r.allocation[None] * water.MM_PER_AF_PER_ACRE + 1e-6).all()


@needs_fallon
def test_200_rotations_run_fast(fallon):
    field, ref = fallon
    rotations = (list(product(["alfalfa", "barley", "fallow"], repeat=3)) * 8)[:200]
    start = time.perf_counter()
    r = water.simulate(field, rotations, ref)
    elapsed = time.perf_counter() - start
    assert r.eta_mm.shape == (200, 275, 3)
    # A guard against an accidental slow-down (e.g. a Python loop over rotations), not a
    # benchmark: about 1 s on a plugged-in laptop, up to 6 s when the same laptop throttles.
    assert elapsed < 20.0, f"{elapsed:.1f}s"
