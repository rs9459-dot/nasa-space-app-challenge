import { DurableObject } from "cloudflare:workers";
import twilio from "twilio";
import { messageFor, twiml } from "./messages";
import type { Env as GeminiEnv } from "./env";
import { handleDev } from "./dev-routes";
import { answerFarmer, HELP_TEXT } from "./farmer";
import type { EngineResult } from "./gemini";

// Messaging settings plus the Gemini layer's (AI binding, Gemini key, gateway) from ./env.
interface Env extends GeminiEnv {
  FARMERS: DurableObjectNamespace<FarmerSession>;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
  TWILIO_WEBHOOK_URL: string;
  ENGINE_REPLY_TOKEN: string;
}
interface Incoming { sid: string; from: string; body: string; optOutType?: string }
interface StoredMessage extends Incoming {
  receivedAt: number;
  sendState?: "sending" | "accepted" | "unknown";
  outboundSid?: string;
}

const json = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { "cache-control": "no-store" }
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ service: "farmline-messaging", status: "ok", cropEngineConnected: !!(env.ENGINE_URL && env.ENGINE_API_TOKEN) });
    }
    // Gemini layer test routes; 404 unless DEV_ROUTES is "1" (local only).
    if (url.pathname.startsWith("/dev/")) return handleDev(request, env);
    if (url.pathname === "/webhooks/sms" && request.method === "POST") {
      if (!env.TWILIO_AUTH_TOKEN || !env.TWILIO_WEBHOOK_URL) return json({ error: "Missing webhook configuration" }, 503);
      if (!(request.headers.get("content-type") || "").startsWith("application/x-www-form-urlencoded")) return json({ error: "Expected form data" }, 415);
      const raw = await request.text();
      if (raw.length > 32768) return json({ error: "Request too large" }, 413);
      const params = Object.fromEntries(new URLSearchParams(raw));
      if (!twilio.validateRequest(env.TWILIO_AUTH_TOKEN, request.headers.get("x-twilio-signature") || "", env.TWILIO_WEBHOOK_URL, params)) {
        return json({ error: "Invalid Twilio signature" }, 403);
      }
      if (params.AccountSid !== env.TWILIO_ACCOUNT_SID || params.To !== env.TWILIO_PHONE_NUMBER) return json({ error: "Wrong account or number" }, 403);
      if (!/^\+[1-9]\d{7,14}$/.test(params.From || "") || !/^SM[a-fA-F0-9]{32}$/.test(params.MessageSid || "")) return json({ error: "Invalid sender or message" }, 400);
      const session = env.FARMERS.get(env.FARMERS.idFromName(params.From));
      return session.receive({ sid: params.MessageSid, from: params.From, body: (params.Body || "").slice(0, 1600), optOutType: params.OptOutType });
    }
    // Private integration API: never expose this token to a browser dashboard.
    if (["/api/messages", "/api/reply"].includes(url.pathname)) {
      if (!env.ENGINE_REPLY_TOKEN || request.headers.get("authorization") !== `Bearer ${env.ENGINE_REPLY_TOKEN}`) return json({ error: "Unauthorized" }, 401);
      if (request.method !== "POST") return json({ error: "Use POST" }, 405);
      let data: { farmerPhone?: string; requestId?: string; text?: string };
      try { data = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "Expected JSON object" }, 400);
      if (!/^\+[1-9]\d{7,14}$/.test(data.farmerPhone || "")) return json({ error: "Invalid farmerPhone" }, 400);
      const session = env.FARMERS.get(env.FARMERS.idFromName(data.farmerPhone!));
      if (url.pathname === "/api/messages") return json(await session.messages());
      if (typeof data.text !== "string" || !data.text.trim() || data.text.length > 480 || !/^SM[a-fA-F0-9]{32}$/.test(data.requestId || "")) return json({ error: "Provide requestId and text (1-480 characters)" }, 400);
      return session.reply(data.requestId!, data.text.trim());
    }
    return json({ error: "Not found" }, 404);
  }
} satisfies ExportedHandler<Env>;

export class FarmerSession extends DurableObject<Env> {
  async receive(message: Incoming): Promise<Response> {
    const handled = await this.ctx.blockConcurrencyWhile(async () => {
      const key = `message:${message.sid}`;
      if (await this.ctx.storage.get(key)) return twiml();
      const result = messageFor(message.body);
      const optOut = message.optOutType === "STOP" ? true : message.optOutType === "START" ? false : result.optedOut;
      if (optOut !== undefined) await this.ctx.storage.put("optedOut", optOut);
      await this.ctx.storage.put(key, { ...message, receivedAt: Date.now() } satisfies StoredMessage);
      await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
      if (message.optOutType || optOut !== undefined || await this.ctx.storage.get("optedOut")) return twiml();
      if (["HELP", "INFO"].includes(message.body.trim().toUpperCase())) return twiml(HELP_TEXT);
      return null;
    });
    if (handled) return handled;
    // A crop question: Gemini reads it, the engine plans, Gemini writes the reply (src/farmer.ts).
    // Done outside the lock; the last plan is kept for "tell me more about option 2".
    const lastResult = await this.ctx.storage.get<EngineResult>("lastResult");
    const answer = await answerFarmer(this.env, message.body, { from: message.from, lastResult });
    if (answer.result) await this.ctx.storage.put("lastResult", answer.result);
    return twiml(answer.text);
  }

  async messages(): Promise<{ messages: StoredMessage[]; optedOut: boolean }> {
    const records = await this.ctx.storage.list<StoredMessage>({ prefix: "message:" });
    return { messages: [...records.values()].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 20), optedOut: !!await this.ctx.storage.get("optedOut") };
  }

  async reply(requestId: string, text: string): Promise<Response> {
    // Claim before calling Twilio. Ambiguous failures must be reconciled manually,
    // rather than automatically retrying and potentially charging/sending twice.
    const record = await this.ctx.blockConcurrencyWhile(async () => {
      const message = await this.ctx.storage.get<StoredMessage>(`message:${requestId}`);
      if (!message || message.receivedAt < Date.now() - 24 * 60 * 60 * 1000 || message.sendState || messageFor(message.body).optedOut !== undefined || ["HELP", "INFO"].includes(message.body.trim().toUpperCase()) || message.optOutType || await this.ctx.storage.get("optedOut")) return null;
      message.sendState = "sending";
      await this.ctx.storage.put(`message:${requestId}`, message);
      return message;
    });
    if (!record) return json({ error: "Unknown, expired, opted-out, command, or already-claimed request" }, 409);
    try {
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: "POST",
        headers: { authorization: `Basic ${btoa(`${this.env.TWILIO_ACCOUNT_SID}:${this.env.TWILIO_AUTH_TOKEN}`)}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: this.env.TWILIO_PHONE_NUMBER, To: record.from, Body: text }),
        signal: AbortSignal.timeout(10000)
      });
      const result = await response.json() as { sid?: string };
      if (!response.ok || !result.sid) throw new Error("Twilio did not confirm acceptance");
      await this.ctx.storage.put(`message:${requestId}`, { ...record, sendState: "accepted", outboundSid: result.sid });
      return json({ status: "accepted", messageSid: result.sid });
    } catch {
      await this.ctx.storage.put(`message:${requestId}`, { ...record, sendState: "unknown" });
      return json({ error: "Send status unknown. Inspect Twilio logs before any retry." }, 502);
    }
  }

  async alarm(): Promise<void> {
    const records = await this.ctx.storage.list<StoredMessage>({ prefix: "message:" });
    const expired = [...records].filter(([, value]) => value.receivedAt < Date.now() - 7 * 24 * 60 * 60 * 1000).map(([key]) => key);
    if (expired.length) await this.ctx.storage.delete(expired);
    if (records.size > expired.length) await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
  }
}
