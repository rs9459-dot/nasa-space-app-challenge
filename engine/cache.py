"""Do the heavy work once per field, then answer every text from it.

What a /plan answer needs splits in two:

  * the same for everyone at a field: every rotation's water and yield outcomes over the
    25 x 11 weather/allocation sequences, each crop's "carry on as before" baseline, and the
    drought hindcast. This is nearly all of the work (tens of seconds with 8 crops).
  * different per text: which baseline (the farmer's crop) and the ranking (their priorities).
    Milliseconds.

`prepared(field_id)` returns the first part, computed once and kept in memory and on disk
(<data>/cache/, gitignored). It is keyed by the size and modified time of every data file it
read and every engine source file, so new data or new code rebuilds it; stale numbers are
never served. `warm_up()` prepares every field in reference/places.csv in the background.
"""
from __future__ import annotations

import copy
import hashlib
import logging
import pickle
import threading
from dataclasses import dataclass, field as dataclass_field
from pathlib import Path

import numpy as np
import pandas as pd

from engine import bundle, water
from engine.bundle import BundleError
from engine.types import Field, Outcomes, Reference, Rotation, Signals

log = logging.getLogger("farmline.engine")
ENGINE_DIR = Path(__file__).resolve().parent
FORMAT = 1  # bump when Prepared changes shape


@dataclass
class Prepared:
    key: str
    field: Field
    ref: Reference
    signals: Signals
    rotations: list[Rotation]
    outcomes: Outcomes
    baselines: dict[str, Outcomes] = dataclass_field(default_factory=dict)  # crop -> (crop, crop, crop)
    hindcast: dict | None = None


_memory: dict[str, Prepared] = {}
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
status: dict[str, str] = {}  # field_id -> "warming" | "ready" | "<error code>: ..." (shown on /health)


def _files(field_id: str) -> list[Path]:
    root = bundle.data_dir()
    data = [*(root / "fields" / field_id).glob("*"), *(root / "reference").glob("*.csv")]
    code = ENGINE_DIR.glob("*.py")
    return sorted(p for p in [*data, *code] if p.is_file())


def key_for(field_id: str) -> str:
    from engine import plan
    h = hashlib.sha256(f"{FORMAT}|{bundle.data_dir().resolve()}|{field_id}|{plan.stand_ins()}".encode())
    for p in _files(field_id):
        st = p.stat()
        h.update(f"|{p.name}:{st.st_size}:{st.st_mtime_ns}".encode())
    return h.hexdigest()[:16]


def _disk_path(field_id: str) -> Path:
    return bundle.data_dir() / "cache" / f"{field_id}.pkl"


def pick(outcomes: Outcomes, rows: list[int]) -> Outcomes:
    return Outcomes(
        rotations=[outcomes.rotations[i] for i in rows],
        yield_frac=outcomes.yield_frac[rows], income_usd=outcomes.income_usd[rows],
        water_af=outcomes.water_af[rows], soil_score=np.asarray(outcomes.soil_score)[rows],
    )


def _complete(field: Field, ref: Reference, crop: str) -> bool:
    """Whether crops.csv has everything the water model needs for this crop."""
    try:
        water.crop_tables(ref.crops, [crop], field.soil)
        return True
    except (BundleError, KeyError, ValueError):
        return False


def compute(field_id: str) -> Prepared:
    """The heavy part, from scratch."""
    from engine import hindcast, plan

    key = key_for(field_id)
    field, ref = bundle.load(field_id)
    signals_module = plan.optional("signals")
    signals = signals_module.compute(field) if signals_module else Signals()
    rotations = plan.candidate_rotations(field, ref)

    # Every crop with a complete row in crops.csv gets its baseline in the same run; any other
    # crop is simulated when a farmer names it (and fails then with the usual no_data error).
    crops = [c for c in ref.crops.index if _complete(field, ref, c)]
    baseline_rotations: list[Rotation] = [(c,) * 3 for c in crops]
    sim = water.simulate(field, [*rotations, *baseline_rotations], ref, signals)
    evaluate = plan.yields_function()
    n = len(rotations)
    outcomes = evaluate(field, plan.take(sim, slice(0, n)), ref, signals)
    baselines: dict[str, Outcomes] = {}
    if baseline_rotations:
        block = evaluate(field, plan.take(sim, slice(n, None)), ref, signals)
        baselines = {c: pick(block, [i]) for i, c in enumerate(crops)}

    try:
        replay = hindcast.run(field, ref, signals, rotations=rotations)
    except BundleError:
        replay = None
    return Prepared(key, field, ref, signals, rotations, outcomes, baselines, replay)


def prepared(field_id: str) -> Prepared:
    """The prepared field: from memory, else disk, else computed (and saved)."""
    with _locks_guard:
        lock = _locks.setdefault(field_id, threading.Lock())
    with lock:  # two texts for a cold field compute it once
        key = key_for(field_id)
        hit = _memory.get(field_id)
        if hit is None or hit.key != key:
            hit = _from_disk(field_id, key)
            if hit is None:
                hit = compute(field_id)
                _to_disk(field_id, hit)
            _memory[field_id] = hit
        status[field_id] = "ready"
        return hit


def baseline(p: Prepared, crop: str) -> Outcomes:
    """The farmer's carry-on-as-before outcomes; simulated now if the crop wasn't prepared."""
    if crop in p.baselines:
        return p.baselines[crop]
    from engine import plan
    sim = water.simulate(p.field, [(crop,) * 3], p.ref, p.signals)
    return plan.yields_function()(p.field, sim, p.ref, p.signals)


def _from_disk(field_id: str, key: str) -> Prepared | None:
    path = _disk_path(field_id)
    try:
        with path.open("rb") as f:
            p = pickle.load(f)  # only ever our own file, written by _to_disk
        return p if isinstance(p, Prepared) and p.key == key else None
    except FileNotFoundError:
        return None
    except Exception:  # an unreadable or outdated cache is just a miss
        log.warning("ignoring unreadable cache %s", path)
        return None


def _to_disk(field_id: str, p: Prepared) -> None:
    path = _disk_path(field_id)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with tmp.open("wb") as f:
            pickle.dump(p, f, protocol=pickle.HIGHEST_PROTOCOL)
        tmp.replace(path)
    except OSError:
        log.warning("could not save cache %s", path)


def fields_to_warm() -> list[str]:
    path = bundle.data_dir() / "reference" / "places.csv"
    if not path.exists():
        return []
    places = pd.read_csv(path, dtype=str)
    return list(dict.fromkeys(places["field_id"].dropna())) if "field_id" in places else []


def warm_up(field_ids: list[str] | None = None) -> threading.Thread:
    """Prepare fields in a background thread; progress is in `status`."""
    ids = fields_to_warm() if field_ids is None else field_ids
    for fid in ids:
        status[fid] = "warming"

    def run() -> None:
        for fid in ids:
            try:
                prepared(fid)
            except BundleError as err:
                status[fid] = f"{err.code}: {err}"
            except Exception as err:  # keep warming the others
                log.exception("warm-up failed for %s", fid)
                status[fid] = f"engine_failed: {type(err).__name__}"

    t = threading.Thread(target=run, name="farmline-warm-up", daemon=True)
    t.start()
    return t


def clear() -> None:
    """Forget everything in memory (tests)."""
    _memory.clear()
    status.clear()
