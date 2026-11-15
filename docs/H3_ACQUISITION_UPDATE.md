> Historical checkpoint. Active cost policy and current values: [H3_UNIVERSITY_COSTS.md](H3_UNIVERSITY_COSTS.md). University costs are now user-authorized; statements below describe the earlier stage.

# H3 acquisition and matching update

Completed November 14, 2026.

Downloaded four official ERS CSV files (grain corn, barley, sorghum and wheat) and the AMS weekly bean PDF. SHA-256 hashes are recorded in h3-official-downloads.json; raw files stay in gitignored data/raw/h3-official/. A reproducible extractor checks hashes, duplicate items, accounting units and reconciliation of operating costs plus allocated overhead against total costs.

Extracted 22 regional 2025 benchmark groups. Basin and Range barley: operating cost 241.84, overhead 319.65, total 561.49 USD/planted acre. Basin and Range wheat: operating cost 201.28, overhead 273.52, total 474.80 USD/planted acre. These are regional sector estimates, not Fallon farm budgets. Corn is grain, not silage. ERS yield and costs use planted acres and must not be silently paired with harvested-acre NASS yields. Water-cost separation remains unresolved. No benchmark was approved as a farmer input.

The AMS report dated November 9, 2026 was downloaded and page 2 rendered and visually checked. Pinto grower bids: Den-Rate 43 USD/cwt and Min-Dak 38 USD/cwt, delivered truck/current delivery. These are regional bids, not confirmed Fallon trades or annual prices. Saved separately; generic dry_beans has not been silently assigned pinto prices.

Created h3-readiness.csv with all eight target crops, available evidence and specific exclusion reasons. All eight currently remain excluded from farmer income rankings; this is not an all-eight-crops H3 completion. Existing economics.csv retains missing costs. No partner engine files changed, and this evidence gate is not claimed to be wired into the partner API.

Validation: 14 targeted economics tests passed, including rejection of duplicate records, mismatched acre bases and nonreconciling costs. All 22 extracted source accounting groups reconciled within 0.03 USD rounding tolerance.

Next: agree a consistent per-acre basis, crop class/management and water-cost accounting before a regional benchmark can support a labeled scenario. Alfalfa, silage, safflower, dry beans and sole-rye current comparable costs remain unestablished. Do not manufacture values to finish the table. No additional login was needed for these downloads. Changes remain local, not committed or pushed.

Sources: https://www.ers.usda.gov/data-products/commodity-costs-and-returns ; https://www.ers.usda.gov/data-products/commodity-costs-and-returns/documentation ; https://www.ams.usda.gov/mnreports/AMS_2914.pdf
