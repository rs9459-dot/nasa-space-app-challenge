import type { Place } from "./types";

/**
 * Main farming towns of Pakistan, in Urdu script and Latin letters, with approximate
 * city-centre coordinates (NASA POWER works on a ~50 km grid, so city level is enough).
 * Built in because Urdu-script town names are not reliably found by free geocoders,
 * and "Hyderabad" in Latin letters is ambiguous with India (so only its Urdu name is listed).
 */
const TOWNS: { ur: string; en: string; lat: number; lon: number; latin?: boolean }[] = [
  { ur: "لاہور", en: "Lahore", lat: 31.55, lon: 74.34 },
  { ur: "فیصل آباد", en: "Faisalabad", lat: 31.42, lon: 73.08 },
  { ur: "ملتان", en: "Multan", lat: 30.2, lon: 71.47 },
  { ur: "ساہیوال", en: "Sahiwal", lat: 30.66, lon: 73.11 },
  { ur: "بہاولپور", en: "Bahawalpur", lat: 29.4, lon: 71.68 },
  { ur: "سرگودھا", en: "Sargodha", lat: 32.08, lon: 72.67 },
  { ur: "گوجرانوالہ", en: "Gujranwala", lat: 32.16, lon: 74.19 },
  { ur: "اوکاڑہ", en: "Okara", lat: 30.81, lon: 73.45 },
  { ur: "رحیم یار خان", en: "Rahim Yar Khan", lat: 28.42, lon: 70.3 },
  { ur: "قصور", en: "Kasur", lat: 31.12, lon: 74.45 },
  { ur: "شیخوپورہ", en: "Sheikhupura", lat: 31.71, lon: 73.99 },
  { ur: "جھنگ", en: "Jhang", lat: 31.27, lon: 72.32 },
  { ur: "خانیوال", en: "Khanewal", lat: 30.3, lon: 71.93 },
  { ur: "ڈیرہ غازی خان", en: "Dera Ghazi Khan", lat: 30.05, lon: 70.63 },
  { ur: "حیدرآباد", en: "Hyderabad (Sindh)", lat: 25.4, lon: 68.37, latin: false },
  { ur: "سکھر", en: "Sukkur", lat: 27.71, lon: 68.85 },
  { ur: "لاڑکانہ", en: "Larkana", lat: 27.56, lon: 68.21 },
  { ur: "میرپور خاص", en: "Mirpur Khas", lat: 25.53, lon: 69.01 },
  { ur: "پشاور", en: "Peshawar", lat: 34.01, lon: 71.58 },
  { ur: "مردان", en: "Mardan", lat: 34.2, lon: 72.05 },
];

/** Find a Pakistani farming town named in the text (Urdu script always; Latin letters if allowed). */
export function findPakistanTown(text: string, allowLatin: boolean): Place | null {
  const lower = text.toLowerCase();
  for (const t of TOWNS) {
    const hit =
      text.includes(t.ur) ||
      (allowLatin && t.latin !== false && new RegExp(`\\b${t.en.toLowerCase()}\\b`).test(lower));
    if (hit) return { lat: t.lat, lon: t.lon, name: t.en, localName: t.ur, country: "pk" };
  }
  return null;
}
