# H2 prototype crop profiles

The ten rows are numerically complete for prototype calculations. They are **not ten
locally calibrated crop recommendations**. The cell ledger distinguishes published
generic values, local observations, regional proxies, derived assumptions, model
assumptions and policy values. Every scalar has a source or design rationale.

## Profile identities

`wheat` means spring grain wheat; `barley` means spring grain barley; `sorghum` means
grain sorghum. `corn` means grain maize and `corn_silage` means harvested forage maize.
`alfalfa` means an established hay stand. `cover_crop` means winter cereal rye grown for
cover and terminated, with no sale revenue. `fallow` means unplanted bare fallow.

## Dates and stages

Annual sowing dates are chosen scenario dates inside broad regional planting windows,
not observed dates for this farm. Compare dates +/- 14 days before interpreting a ranking.
FAO growth-stage examples are regional proxies; they require cultivar/local calibration.
Alfalfa uses a 220-day April-to-autumn scenario and FAO coefficients averaged across
cuttings, not a single 220-day cutting. The four-stage curve cannot represent individual
cuts, establishment-year yield penalties or stand removal/autotoxicity.

The rye profile uses October 3, a treatment in the NRCS Fallon report, and a 230-day
overwinter season scenario. Its four-stage coefficient curve is a coarse placeholder:
it does not model winter dormancy separately. Do not interpret its winter irrigation
as verified district delivery availability. The report's abstract and methods differ on
the first October treatment date; this profile explicitly uses the methods' October 3.

Silage stage lengths and late Kc are management assumptions for earlier forage harvest;
they are not grain-maize observations repackaged as silage measurements.

## Ranges and proxies

Root depths use the midpoint of FAO-56 Table 22 ranges; actual soil impedance and water
table may constrain rooting. Rooting depth is a crop property here, not a SSURGO measurement.
The current water engine chooses between its 100/150-cm soil buckets; it does not integrate
a continuous root profile, and it does not limit roots to 10 cm for fallow evaporation.

Scalar choices within Kc ranges and the alfalfa Ky range are explicit scenario selections.
Barley Ky borrows spring wheat; silage Ky borrows grain maize. These proxies require
sensitivity analysis and are not validated species/harvest-specific response measurements.
Safflower salinity uses a wheat response as a screening assumption because FAO's reference
table gives no numeric safflower fit. This does not establish that the proxy is conservative
for every cultivar or site. Rye biomass salinity is also a wheat proxy, not a rye grain fit.

Fallow has zero growth stages, zero sale/yield, and Kc=0.15 for the engine's off-season
evaporation approximation. Its root, depletion and salinity entries are policy placeholders;
they do not describe a growing plant. Never irrigate fallow to obtain crop yield.

## Heat units and frost

Wheat and barley use published **Celsius degree-day** maturity ranges at base 0 C; the
profile selects each range midpoint. Integrate from the sowing date through the growing
season, not across the whole year. These Saskatchewan/Montana observations are regional
proxies. They are not a local cultivar guarantee.

For other profiles `gdd_required=0` means **thermal eligibility check disabled**, not
zero biological heat need. There is no justifiable cultivar requirement in the verified
sources under one shared calculation convention. Reports must identify this unchecked
condition. Do not relabel these crops as climate-validated merely because 0 is easy to pass.
Corn modified GDD caps require a matching cultivar threshold before enabling that gate.
Frost-free thresholds are USU Cache Valley proxies. Winter rye does not need a contiguous
frost-free interval to survive winter; its zero threshold disables that annual-crop gate.

## Custom rotation and soil-score rubric

These scores are model design, not measured improvements or an NRCS rating system.
Heavy feeder=1 for grain maize, silage maize and sorghum for the adjacent-crop constraint;
the rule is a simplification, not a substitute for nutrient budgets.

- Residue 0: no new crop residue; 1: most above-ground biomass removed; 2: intermediate;
  3: retained high-residue grain straw or terminated cover. Residue retention is assumed.
- Deep roots 0: no crop; 1: relatively shallow; 2: intermediate/fibrous; 3: deep-rooted
  perennial/taproot scenario. Scores are ordinal and separate from depth in metres.
- Cover benefit 0: absent; 1: seasonal annual cover; 2: persistent alfalfa; 3: dedicated
  overwinter cover. Harvest/termination timing and residue removal change these values.

The yields module must document its scaling to 0-10. Do not claim increased soil carbon,
erosion reductions, nitrogen credits, or yield carryover from these ordinal scores alone.

## Readiness boundaries and integration

Use `python -m pipeline.crop_reference` for structural validation and the readiness report.
`--require-advice-ready` fails while the provenance flag is false. Passing structural tests
means the table loads and supplies finite engine inputs, not that field performance is proven.

For actual farmer advice, obtain local agronomic review of profiles, planting/termination
rules and soil EC measurement equivalence, validate water against observations, and complete
the H3 economics. None of these are fabricated by this table. Those dependencies remain
separate from finishing the H2 prototype parameter file.

Sources: FAO-56 Tables 11/12/22/23, FAO irrigation-scheduling annex Table 12,
USU Cache Valley crop screening, Montana State phenology guide, and the NRCS Fallon rye
study. URLs and per-cell provenance are in crop_parameter_provenance.json.
