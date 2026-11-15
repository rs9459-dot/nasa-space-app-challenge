import { placeForCode, placeForName } from "./data";
import { findPakistanTown } from "./places_pk";
import { findPostalCode, placeCandidates } from "./reply";
import type { Detected, Env, Place, Trace } from "./types";

/** Find the farm's place in free text: Pakistan town list, US ZIP / India PIN code, or a town name anywhere. */
export async function findPlace(env: Env, text: string, detected: Detected): Promise<{ place: Place | null; looked: boolean; via?: Trace["via"]; lookup?: string }> {
  if (detected === "ur" || detected === "roman") {
    const town = findPakistanTown(text, detected === "roman");
    if (town) return { place: town, looked: true, via: "pk_town", lookup: town.name };
  }
  const code = detected === "sw" || detected === "ur" ? null : findPostalCode(text);
  if (code) {
    const place = await placeForCode(env, code);
    if (place) return { place, looked: true, via: "postal", lookup: code };
  }
  const names = placeCandidates(text);
  for (const n of names) {
    const place = await placeForName(env, n);
    if (place) return { place, looked: true, via: "town_name", lookup: n };
  }
  return { place: null, looked: Boolean(code) || names.length > 0 };
}
