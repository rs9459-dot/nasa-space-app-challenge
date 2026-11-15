# FarmLine ↔ rotation engine

FarmLine calls the engine once per "What should I plant next?" question, after the farmer has answered the menu questions.
Set the engine's public URL in `wrangler.toml` as `ENGINE_URL`, then `npx wrangler deploy`.

## Request

`POST ENGINE_URL` with `Content-Type: application/json`

```json
{
  "lat": 18.40,
  "lon": 76.56,
  "country": "in",
  "place": "Latur, Maharashtra",
  "crop": "cotton",
  "irrigated": true,
  "water_outlook": "less",
  "priority": "water",
  "years": 3,
  "question": "cotton irrigated=true outlook=less priority=water"
}
```

| Field | Values | Notes |
|---|---|---|
| `lat`, `lon` | numbers | farm area (rounded by FarmLine; never an exact farm) |
| `country` | ISO code, lowercase | `in`, `us`, `ke`, `tz`, … |
| `place` | text | for logs only |
| `crop` | English crop name, lowercase | what is growing now / just harvested (may be free text the farmer typed) |
| `irrigated` | `true` / `false` | "Is your field watered?" |
| `water_outlook` | `"same"` / `"less"` / `"much_less"` / missing | only asked when irrigated |
| `priority` | `"water"` / `"income"` / `"safe"` | "What matters most?" |
| `years` | `3` | length of each plan |

Old one-message requests (a farmer texting "alfalfa 89406") send only `lat`, `lon`, `country`, `place`, `crop`, `question`, `years`.

## Response

`200` with JSON. FarmLine waits up to **20 seconds** in the menu flow (6 seconds for one-message answers and calls).

```json
{
  "options": [
    {
      "kind": "water",
      "rotation": ["soybean", "chickpea", "sorghum"],
      "water_saving_pct": 48,
      "income_change_pct": -6,
      "bad_year_income_change_pct": 4,
      "years": [
        { "year": 1, "crop": "soybean", "sow": "sow in June after the first rains" },
        { "year": 2, "crop": "chickpea", "sow": "sow in October on leftover soil moisture" },
        { "year": 3, "crop": "sorghum", "sow": "sow in June" }
      ],
      "why": "Your soil is drier than most years and the monsoon was weak. Chickpea grows on moisture left in the soil, so it needs little extra water."
    },
    { "kind": "income", "rotation": ["soybean", "cotton", "chickpea"], "water_saving_pct": 10, "income_change_pct": 12, "bad_year_income_change_pct": -18 },
    { "kind": "drought", "rotation": ["pigeon pea", "sorghum", "chickpea"], "water_saving_pct": 35, "income_change_pct": -2, "bad_year_income_change_pct": 6 }
  ]
}
```

**Required** for each option: `kind` (`"water"`, `"income"` or `"drought"`, in that order), `rotation` (3 crop names, English, lowercase), `water_saving_pct`, `income_change_pct`, `bad_year_income_change_pct` (all compared with the farmer's current crop; positive water = saves water).

**Optional** (FarmLine fills them in if missing):
- `years[]`: what to plant each year and when. Without it, FarmLine lists "Year 1: Soybean", "Year 2: …" from `rotation`. The `sow` text is shown in English replies only (Hindi/Kiswahili show the crop and year), so numbers and months are never mistranslated.
- `why`: one or two plain English sentences for the farmer's "WHY". Without it, FarmLine writes its own from NASA rain data ("rain near Latur in the last 30 days was 42% of normal") plus the plan type. With it, FarmLine sends it as-is in English, or translates it for Hindi/Kiswahili with every number checked.

If the engine is down, slow or returns no options, the farmer gets their NASA rain data and "Crop plans aren't ready right now", and `/admin` shows the engine as not answering.

## Test it

```bash
curl -s -X POST "$ENGINE_URL" -H 'Content-Type: application/json' \
  -d '{"lat":18.4,"lon":76.56,"country":"in","crop":"cotton","irrigated":true,"water_outlook":"less","priority":"water","years":3}'
```
