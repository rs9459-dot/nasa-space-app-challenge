// Admin login with Auth0 (OpenID Connect, authorization-code flow).
// /admin is locked until AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, ADMIN_EMAILS and SESSION_SECRET are set.
// Only emails listed in ADMIN_EMAILS, and verified by Auth0, get in. The session is a signed cookie (12 hours).
import type { Context, Next } from "hono";
import type { Env } from "./types";

const COOKIE = "fl_admin";
const STATE = "fl_state";
const HOURS = 12;

const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
const utf8 = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, utf8.encode(data)));
}

/** Constant-time string compare, so the signature check doesn't leak timing. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const authConfigured = (env: Env) =>
  Boolean(env.AUTH0_DOMAIN && env.AUTH0_CLIENT_ID && env.AUTH0_CLIENT_SECRET && env.ADMIN_EMAILS && env.SESSION_SECRET);

const domain = (env: Env) => env.AUTH0_DOMAIN!.replace(/^https?:\/\//, "").replace(/\/+$/, "");
const allowed = (env: Env) => (env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

function readCookie(c: Context, name: string): string | null {
  const m = (c.req.header("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}
const setCookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

/** Make the signed session cookie value (also used by the tests). */
export async function makeSession(secret: string, email: string, now = Date.now()): Promise<string> {
  const body = b64url(utf8.encode(JSON.stringify({ email, exp: now + HOURS * 3600e3 })));
  return `${body}.${await hmac(secret, body)}`;
}

/** The signed-in admin's email, or null. */
export async function sessionEmail(env: Env, c: Context): Promise<string | null> {
  if (!authConfigured(env)) return null;
  const raw = readCookie(c, COOKIE);
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig || !same(sig, await hmac(env.SESSION_SECRET!, body))) return null;
  try {
    const s = JSON.parse(fromB64url(body)) as { email: string; exp: number };
    if (s.exp < Date.now() || !allowed(env).includes(s.email.toLowerCase())) return null;
    return s.email;
  } catch {
    return null;
  }
}

/** Middleware for every /admin page except login, callback and logout. */
export async function adminOnly(c: Context<{ Bindings: Env; Variables: any }>, next: Next) {
  const env = c.env;
  if (!authConfigured(env)) return c.html(setupPage(env), 503);
  const email = await sessionEmail(env, c);
  if (!email) return c.redirect("/admin/login");
  c.set("admin", email);
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex");
  await next();
}

export function login(c: Context<{ Bindings: Env; Variables: any }>) {
  const env = c.env;
  if (!authConfigured(env)) return c.html(setupPage(env), 503);
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const q = new URLSearchParams({
    response_type: "code",
    client_id: env.AUTH0_CLIENT_ID!,
    redirect_uri: new URL("/admin/callback", c.req.url).toString(),
    scope: "openid email profile",
    state,
  });
  c.header("Set-Cookie", setCookie(STATE, state, 600));
  return c.redirect(`https://${domain(env)}/authorize?${q}`);
}

export async function callback(c: Context<{ Bindings: Env; Variables: any }>) {
  const env = c.env;
  if (!authConfigured(env)) return c.html(setupPage(env), 503);
  const { code, state, error, error_description } = c.req.query();
  if (error) return c.html(messagePage("Sign-in was cancelled", error_description || error), 401);
  const expected = readCookie(c, STATE);
  if (!code || !state || !expected || !same(state, expected)) return c.html(messagePage("Sign-in expired", "Start again from the sign-in page."), 400);

  // Swap the code for tokens directly with Auth0 over TLS, so the ID token comes straight from Auth0.
  // Auth0 apps accept the secret either in the body (client_secret_post) or as Basic auth (client_secret_basic): try both.
  const id = env.AUTH0_CLIENT_ID!.trim();
  const secret = env.AUTH0_CLIENT_SECRET!.trim();
  const base = { grant_type: "authorization_code", code, redirect_uri: new URL("/admin/callback", c.req.url).toString() };
  const tokenUrl = `https://${domain(env)}/oauth/token`;
  let res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...base, client_id: id, client_secret: secret }),
  });
  if (res.status === 401) {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`)}` },
      body: new URLSearchParams(base).toString(),
    });
  }
  if (!res.ok) {
    // Show Auth0's own reason (never contains the secret), e.g. "access_denied: Unauthorized" = wrong client secret.
    let why = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string; error_description?: string };
      why = [j.error, j.error_description].filter(Boolean).join(": ") || why;
    } catch { /* keep the status */ }
    const hint = /unauthori[sz]ed|invalid_client/i.test(why)
      ? "This usually means AUTH0_CLIENT_SECRET on the Worker doesn't match the Client Secret in Auth0. Copy it again from Auth0 and run: pbpaste | npx wrangler secret put AUTH0_CLIENT_SECRET"
      : /redirect|callback/i.test(why) ? "Check Allowed Callback URLs in Auth0." : /grant/i.test(why)
      ? "In Auth0: Settings > Advanced Settings > Grant Types, turn on Authorization Code, and make sure the app type is Regular Web Application." : "";
    return c.html(messagePage("Sign-in failed", `Auth0 said: ${why}. ${hint}`), 401);
  }
  const { id_token } = (await res.json()) as { id_token?: string };
  let claims: { email?: string; email_verified?: boolean; aud?: string; iss?: string; exp?: number } = {};
  try {
    claims = JSON.parse(fromB64url((id_token ?? "").split(".")[1] ?? ""));
  } catch {
    /* handled below */
  }
  const okToken = claims.aud === id && claims.iss === `https://${domain(env)}/` && (claims.exp ?? 0) * 1000 > Date.now();
  const email = (claims.email ?? "").toLowerCase();
  if (!okToken) return c.html(messagePage("Sign-in failed", "Auth0's answer didn't match this app (check AUTH0_DOMAIN and AUTH0_CLIENT_ID)."), 403);
  if (!email) return c.html(messagePage("No email from Auth0", "This sign-in didn't share an email. Use Continue with Google, or turn on the email scope for your login method in Auth0."), 403);
  if (claims.email_verified !== true) return c.html(messagePage("Email not verified", `${email} isn't verified yet. Use Continue with Google, or open the verification email Auth0 sent you.`), 403);
  if (!allowed(env).includes(email)) {
    return c.html(messagePage("Not on the admin list", `You signed in as ${email}, which isn't in ADMIN_EMAILS. Sign out of Auth0 and choose the right Google account, or add this email to ADMIN_EMAILS in wrangler.toml and deploy.`), 403);
  }
  const headers = new Headers({ Location: "/admin" });
  headers.append("Set-Cookie", setCookie(COOKIE, await makeSession(env.SESSION_SECRET!, email), HOURS * 3600));
  headers.append("Set-Cookie", setCookie(STATE, "", 0));
  return new Response(null, { status: 302, headers });
}

export function logout(c: Context<{ Bindings: Env; Variables: any }>) {
  const env = c.env;
  const home = new URL("/", c.req.url).toString();
  const to = authConfigured(env)
    ? `https://${domain(env)}/v2/logout?${new URLSearchParams({ client_id: env.AUTH0_CLIENT_ID!, returnTo: home })}`
    : home;
  c.header("Set-Cookie", setCookie(COOKIE, "", 0));
  return c.redirect(to);
}

// ---------- small pages ----------

const shell = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title} · FarmLine admin</title>
<style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#14100d;color:#eef1ea;font:400 17px/1.6 "Public Sans",system-ui,sans-serif;padding:24px}
main{max-width:560px}h1{font:600 30px/1.2 Georgia,serif;margin:0 0 12px}p,li{color:#c9c2b6}code{background:#241c16;color:#ebc774;padding:2px 6px;border-radius:4px;font-size:.92em}a{color:#ebc774}</style></head><body><main>${body}</main></body></html>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function messagePage(title: string, text: string) {
  return shell(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="/admin/logout">Sign out and try another account</a> · <a href="/">Public page</a></p>`);
}

function setupPage(env: Env) {
  const all: [keyof Env, string][] = [
    ["AUTH0_DOMAIN", "wrangler.toml"], ["AUTH0_CLIENT_ID", "wrangler.toml"], ["ADMIN_EMAILS", "wrangler.toml"],
    ["AUTH0_CLIENT_SECRET", "npx wrangler secret put AUTH0_CLIENT_SECRET"], ["SESSION_SECRET", "npx wrangler secret put SESSION_SECRET"],
  ];
  const missing = all.filter(([k]) => !env[k]);
  return shell(
    "Admin is locked",
    `<h1>The admin view is locked</h1><p>It shows farmers' phone numbers and messages, so it opens only after the Auth0 login is set up. Still missing on this Worker:</p>
<ul>${missing.map(([k, how]) => `<li><code>${k}</code>: set it with <code>${esc(how)}</code></li>`).join("")}</ul>
<p>Then run <code>npx wrangler deploy</code> and reload this page.</p>
<p><a href="/">Back to the public page</a></p>`,
  );
}
