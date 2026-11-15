import type { Env } from "./types";

/**
 * Check X-Twilio-Signature: HMAC-SHA1 (auth token as key) over the full request URL
 * followed by every POST parameter, sorted by name, as name+value. Base64 encoded.
 */
export async function isValidTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null | undefined,
  authToken: string,
): Promise<boolean> {
  if (!signature || !authToken) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Wrap TwiML verbs in a <Response> and return it with the right content type. */
export function twiml(inner: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

/** Send an SMS through the Twilio REST API (used for the summary after a call). */
export async function sendSms(env: Env, to: string, body: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    // WhatsApp farmers ("whatsapp:+...") are answered from the WhatsApp sender (Twilio sandbox by default).
    body: new URLSearchParams({ To: to, From: to.startsWith("whatsapp:") ? env.WHATSAPP_FROM || "whatsapp:+14155238886" : env.TWILIO_NUMBER, Body: body }),
  });
  if (!res.ok) console.error("Twilio SMS failed", res.status, await res.text());
}
