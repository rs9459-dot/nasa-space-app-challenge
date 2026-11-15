# H5 prototype status

Implemented locally in engine/yields.py. The calculation combines the documented Ky water-response factor with a linear salinity factor, and computes annual average net return as stressed baseline yield times price, less production cost and water charge.

The Fallon check evaluated 21 rotations across 275 scenarios. Yield fractions were finite. No net return was reported because water_cost_usd_per_af is missing; missing charges are not treated as zero. TCID annual per-acre assessments must not be relabeled as a per-acre-foot price without an agreed, supported conversion or a revised cost interface.

All results remain prototypes. USDA observed yields are not unstressed potential yields, so applying stress can double-count historical stress. Soil EC equivalence to ECe is unverified. Historical budgets and revenue years are not inflation aligned. Regional observations are proxies, not Fallon measurements. The soil score is an ordinal design rubric, not measured soil improvement.

Internal unavailable values are NaN; adapters must convert them to null and display estimate unavailable. display_net_return provides a scalar adapter. SMS/API integration is not completed by this module.

H4/H5 changes remain local pending review and publication. H3 was reported reviewed and merged by the user; this local branch has not been verified synchronized with that merge.
