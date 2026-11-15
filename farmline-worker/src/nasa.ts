import type { Place, Weather } from "./types";

const TIMEOUT_MS = 8000; // Twilio waits ~15 s for our reply; leave room for the rest

/** US ZIP (5 digits) or Indian PIN (6 digits) -> coordinates, via the free Zippopotam.us API. */
export async function geocode(code: string): Promise<Place | null> {
  const country = /^\d{5}$/.test(code) ? "us" : /^\d{6}$/.test(code) ? "in" : null;
  if (!country) return null;
  const res = await fetch(`https://api.zippopotam.us/${country}/${code}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    places?: { "place name": string; "state abbreviation"?: string; state?: string; latitude: string; longitude: string }[];
  };
  const p = j.places?.[0];
  if (!p) return null;
  const region = p["state abbreviation"] || p.state || "";
  return {
    lat: Number(p.latitude),
    lon: Number(p.longitude),
    name: region ? `${p["place name"]}, ${region}` : p["place name"],
    country,
  };
}

/** Town or village name -> coordinates, any country, via the free Open-Meteo geocoding API. */
export async function geocodeName(name: string, countryCode?: string): Promise<Place | null> {
  if (name.trim().length < 3) return null;
  const cc = countryCode ? `&countryCode=${countryCode.toUpperCase()}` : "";
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name.trim())}&count=1&format=json${cc}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) return null;
  const j = (await res.json()) as {
    results?: { name: string; latitude: number; longitude: number; country_code?: string; admin1?: string }[];
  };
  const r = j.results?.[0];
  if (!r) return null;
  return {
    lat: r.latitude,
    lon: r.longitude,
    name: r.admin1 && r.admin1 !== r.name ? `${r.name}, ${r.admin1}` : r.name,
    country: (r.country_code ?? "").toLowerCase(),
  };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * Last 30 days of rain and heat from NASA POWER (daily, agriculture community),
 * compared with the POWER long-term climatology for the same months.
 */
export async function getWeather(lat: number, lon: number, now = new Date()): Promise<Weather> {
  const end = new Date(now.getTime() - 3 * 864e5); // POWER daily data lags a few days
  const start = new Date(end.getTime() - 44 * 864e5); // extra days in case recent ones are missing
  const base = "https://power.larc.nasa.gov/api/temporal";
  const loc = `community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;

  const [daily, clim] = await Promise.all([
    fetch(`${base}/daily/point?parameters=PRECTOTCORR,T2M_MAX,GWETROOT&start=${ymd(start)}&end=${ymd(end)}&${loc}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
    fetch(`${base}/climatology/point?parameters=PRECTOTCORR&${loc}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  ]);
  if (!daily.ok || !clim.ok) throw new Error(`NASA POWER error ${daily.status}/${clim.status}`);

  const d = (await daily.json()) as { properties: { parameter: Record<string, Record<string, number>> } };
  const c = (await clim.json()) as { properties: { parameter: Record<string, Record<string, number>> } };

  const rain = d.properties.parameter.PRECTOTCORR ?? {};
  const tmax = d.properties.parameter.T2M_MAX ?? {};
  const soil = d.properties.parameter.GWETROOT ?? {}; // root-zone soil wetness, 0 (dry) to 1 (saturated)
  const normals = c.properties.parameter.PRECTOTCORR ?? {}; // mm/day per month

  // Keep the most recent 30 days where both values are real (POWER uses -999 for missing).
  const valid = Object.keys(rain)
    .filter((k) => rain[k] > -900 && (tmax[k] ?? -999) > -900)
    .sort()
    .slice(-30);
  if (valid.length < 10) throw new Error("Not enough recent NASA POWER data");

  let rain30mm = 0;
  let normal30mm = 0;
  let highSum = 0;
  for (const k of valid) {
    rain30mm += rain[k];
    highSum += tmax[k];
    const month = MONTHS[Number(k.slice(4, 6)) - 1];
    normal30mm += normals[month] ?? 0;
  }
  const soilDays = Object.keys(soil).filter((k) => soil[k] >= 0 && soil[k] <= 1).sort();
  const soilRoot = soilDays.length ? soil[soilDays[soilDays.length - 1]] : undefined;
  return { rain30mm, normal30mm, avgHighC: highSum / valid.length, days: valid.length, soilRoot };
}

/** Rain forecast for the next 7 days (Open-Meteo, free, no key). NASA POWER has no forecast. */
export async function getForecast(lat: number, lon: number): Promise<{ next3mm: number; next7mm: number; maxDayMm: number; maxDayIn: number }> {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&daily=precipitation_sum&forecast_days=7&timezone=auto`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`forecast error ${res.status}`);
  const j = (await res.json()) as { daily?: { precipitation_sum?: (number | null)[] } };
  const mm = (j.daily?.precipitation_sum ?? []).map((x) => (typeof x === "number" ? x : 0));
  let maxDayMm = 0, maxDayIn = 0;
  mm.forEach((x, i) => { if (x > maxDayMm) { maxDayMm = x; maxDayIn = i; } });
  const sum = (a: number[]) => a.reduce((s2, x) => s2 + x, 0);
  return { next3mm: sum(mm.slice(0, 3)), next7mm: sum(mm), maxDayMm, maxDayIn };
}
