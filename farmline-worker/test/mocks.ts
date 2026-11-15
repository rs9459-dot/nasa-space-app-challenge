// In-memory stand-ins for Cloudflare bindings, for offline tests. D1 uses real SQLite (node:sqlite).
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { FarmerSession } from "../src/session";

export function makeKV() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string, type?: string) {
      const v = store.get(key);
      return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

export function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    async run() {
      db.prepare(sql).run(...(args as any[]));
      return { success: true };
    },
    async all() {
      return { results: db.prepare(sql).all(...(args as any[])) };
    },
    async first() {
      return db.prepare(sql).get(...(args as any[])) ?? null;
    },
  });
  return {
    raw: db,
    prepare: (sql: string) => stmt(sql),
    async batch(stmts: { all: () => Promise<unknown> }[]) {
      return Promise.all(stmts.map((s) => s.all()));
    },
  };
}

export function makeDO() {
  const objects = new Map<string, FarmerSession>();
  return {
    idFromName: (name: string) => name,
    get(id: string) {
      if (!objects.has(id)) {
        const mem = new Map<string, unknown>();
        const state = { storage: { get: async (k: string) => mem.get(k), put: async (k: string, v: unknown) => void mem.set(k, v), delete: async (k: string) => mem.delete(k) } };
        objects.set(id, new FarmerSession(state as any));
      }
      const obj = objects.get(id)!;
      return { fetch: (url: string, init?: RequestInit) => obj.fetch(new Request(url, init)) };
    },
  };
}

export function makeQueue() {
  const sent: { body: unknown }[] = [];
  return { sent, async sendBatch(msgs: { body: unknown }[]) { sent.push(...msgs); } };
}

/** Fake embeddings: content words hashed into 512 dimensions (enough to rank by shared words in tests). */
export function fakeEmbed(text: string): number[] {
  const stop = new Set(["the", "and", "your", "you", "what", "should", "are", "for", "with", "that", "this", "can", "how", "don", "get", "into", "more", "than", "when", "not", "its", "but", "all", "from", "out", "has", "have", "they", "them", "which", "much", "less", "just", "only", "such", "may", "often", "first", "then", "after", "before", "same", "time", "area", "normal", "farmline", "nasa", "check", "keep", "make"]);
  const v = new Array(512).fill(0);
  for (const raw of text.toLowerCase().match(/[\p{L}]{3,}/gu) ?? []) {
    if (stop.has(raw)) continue;
    const w = raw.replace(/(ing|ed|s)$/, "");
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % 512] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

export function makeAI(answer: (prompt: string) => string) {
  const calls: unknown[] = [];
  return {
    calls,
    heard: "", // what fake Whisper "hears" on the next recording
    async run(_model: string, input: { messages?: { content: string }[]; text?: string[]; audio?: string }) {
      calls.push(input);
      if (input.audio !== undefined) return { text: this.heard };
      if (input.text) return { data: input.text.map(fakeEmbed) };
      return { response: answer(input.messages![1].content) };
    },
  };
}

export function makeVectorize() {
  const items = new Map<string, { values: number[]; metadata?: unknown }>();
  return {
    items,
    async upsert(vs: { id: string; values: number[]; metadata?: unknown }[]) { for (const v of vs) items.set(v.id, v); return { mutationId: "m" }; },
    async query(q: number[], opts: { topK?: number }) {
      const matches = [...items.entries()].map(([id, v]) => ({ id, score: v.values.reduce((a, x, i) => a + x * q[i], 0), metadata: v.metadata }))
        .sort((a, b) => b.score - a.score).slice(0, opts.topK ?? 3);
      return { matches, count: matches.length };
    },
  };
}

export function makeR2() {
  const objects = new Map<string, { body: string; httpMetadata?: { contentType?: string; contentDisposition?: string }; customMetadata?: Record<string, string> }>();
  return {
    objects,
    async put(key: string, body: string, opts: any = {}) { objects.set(key, { body, httpMetadata: opts.httpMetadata, customMetadata: opts.customMetadata }); return {}; },
    async get(key: string) {
      const o = objects.get(key);
      if (!o) return null;
      return {
        body: o.body,
        writeHttpMetadata(h: Headers) { if (o.httpMetadata?.contentType) h.set("Content-Type", o.httpMetadata.contentType); if (o.httpMetadata?.contentDisposition) h.set("Content-Disposition", o.httpMetadata.contentDisposition); },
      };
    },
    async list(opts: { prefix?: string } = {}) {
      return { objects: [...objects.entries()].filter(([k]) => k.startsWith(opts.prefix ?? "")).map(([key, o]) => ({ key, size: o.body.length, customMetadata: o.customMetadata })) };
    },
  };
}
