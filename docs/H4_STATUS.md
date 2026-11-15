> Superseded candidate counts: see H4_ECONOMICS_UPDATE.md. Three candidates and 21 rotations after user-authorized regional USDA proxies.

# H4 prototype rotation selection

Implemented candidate_crops, candidate_report and enumerate_rotations in engine/rotations.py against existing Field/Reference interfaces; shared partner files are unchanged.

Current pilot geography is explicitly Nevada (country US and Nevada in place), using US-NV economics rows. Other regions fail closed. Complete economics means finite nonnegative yield, price and cost in exactly one matching row; missing inputs are not zero. A state economics row supports only state-level context, not evidence of a local buyer. The current eight profiles already have an explicit target-region economics row.

Thermal screen uses planting-date growing seasons with their summed stage duration, daily mean-temperature GDD clipped at zero, and longest uninterrupted daily Tmin >0C spell within each season. Every complete available season must pass. Incomplete seasons are skipped, and no complete season excludes the crop. This is a conservative prototype policy, not a calibrated probability of success. gdd_required=0 remains explicitly unchecked, not a validated heat requirement. Crop profiles still contain separately documented assumptions; eligibility is not advice approval.

Three-year sequences reject a repeated annual crop in all three years, adjacent heavy feeders and multiple fallow years; perennials may repeat. No invented crop count is enforced.

Real Fallon run: alfalfa only, one sequence (alfalfa, alfalfa, alfalfa). Missing economics excludes alternatives; some also fail the conservative frost screen. Full reasons saved in H4_FALLON_CHECK.json. Four unit tests passed for rules, missing economics, disabled GDD warnings and unknown crops. Real bundle loaded successfully. H4 is computationally implemented but a useful multi-option rotation demonstration remains blocked by reference coverage. No model results have been presented as measured farm performance.

Local branch feat/engine-rotations was created from the local H3 commit 29fa783, keeping PR3 review separate. It does not yet include the browser-created 363805b conflict-resolution commit; synchronize with the reviewed H3 branch before publishing H4. No commit or push performed for H4.
