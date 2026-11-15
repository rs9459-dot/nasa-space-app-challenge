import { geocode, geocodeName, getForecast, getWeather } from "./nasa";
import { cached } from "./store";
import type { Env, Place, Weather } from "./types";

/** NASA POWER weather for a point, cached in KV for 6 hours (same day, ~1 km grid key). */
export function weatherFor(env: Env, lat: number, lon: number): Promise<Weather> {
  const day = new Date().toISOString().slice(0, 10);
  return cached(env, `w:${lat.toFixed(2)}:${lon.toFixed(2)}:${day}`, 6 * 3600, () => getWeather(lat, lon));
}

/** ZIP/PIN code lookup, cached for 30 days (codes do not move). */
export function placeForCode(env: Env, code: string): Promise<Place | null> {
  return cached(env, `zip:${code}`, 30 * 86400, () => geocode(code));
}

/** Town-name lookup, cached for 30 days. */
export function placeForName(env: Env, name: string, countryCode?: string): Promise<Place | null> {
  return cached(env, `town:${countryCode ? countryCode + ":" : ""}${name.toLowerCase()}`, 30 * 86400, () => geocodeName(name, countryCode));
}

/** 7-day rain forecast, cached for 3 hours. */
export function forecastFor(env: Env, lat: number, lon: number) {
  const hour = new Date().toISOString().slice(0, 13);
  return cached(env, `fc:${lat.toFixed(2)}:${lon.toFixed(2)}:${hour.slice(0, 11)}${Math.floor(Number(hour.slice(11)) / 3)}`, 3 * 3600, () => getForecast(lat, lon));
}
