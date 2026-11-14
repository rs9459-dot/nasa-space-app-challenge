/**
 * SMS length rules. One stray curly quote turns a message from GSM-7 (160 chars a
 * segment) into UCS-2 (70), so the same text can jump from 2 segments to 5.
 * Hindi and Urdu script are always UCS-2.
 */

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";
const basic = new Set(GSM_BASIC);
const extended = new Set(GSM_EXTENDED);

export type Encoding = "GSM-7" | "UCS-2";

export interface SmsInfo {
  encoding: Encoding;
  /** Length in the units the encoding counts: septets for GSM-7, UTF-16 units for UCS-2. */
  units: number;
  segments: number;
}

export function smsInfo(text: string): SmsInfo {
  let septets = 0;
  let gsm = true;
  for (const ch of text) {
    if (basic.has(ch)) septets += 1;
    else if (extended.has(ch)) septets += 2;
    else { gsm = false; break; }
  }
  if (gsm) return { encoding: "GSM-7", units: septets, segments: septets <= 160 ? 1 : Math.ceil(septets / 153) };
  const units = text.length; // UTF-16 code units; emoji count 2
  return { encoding: "UCS-2", units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}

/**
 * Replace typographic characters models like to write with GSM-safe ones, and fold
 * accents GSM-7 lacks to their base letter (Spanish "cártamo" -> "cartamo"), so a
 * Latin-script message isn't sent as UCS-2 at less than half the room. Letters with
 * no GSM base (Devanagari, Arabic) are left alone: that text is UCS-2 anyway.
 */
export function toGsmFriendly(text: string): string {
  return foldAccents(tidy(text));
}

function foldAccents(text: string): string {
  let out = "";
  for (const ch of text) {
    if (basic.has(ch) || extended.has(ch)) { out += ch; continue; }
    const base = ch.normalize("NFD").replace(/\p{M}/gu, "");
    out += base.length === 1 && basic.has(base) ? base : ch;
  }
  return out;
}

function tidy(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[•·]/g, "-")
    .replace(/→/g, ">")
    .replace(/[*_`#]/g, "") // markdown the model may add
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
