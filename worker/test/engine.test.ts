/** callEngine(): the Worker's side of contract B, against a fake engine (no network). */
import { describe, expect, it } from "vitest";
import { callEngine, ENGINE_CROPS, toEngineRequest } from "../src/engine";
import type { Env } from "../src/env";
import type { ParsedMessage } from "../src/gemini";
import normal from "../../contracts/samples/plan-normal.json";

const env = { ENGINE_URL: "https://engine.example/", ENGINE_API_TOKEN: "secret" } as Env;
const req = { zip: "89406", current_crop: "alfalfa", priorities: { water: 0.5, income: 0.25, drought: 0.25 } };

function parsed(over: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    intent: "rotation_plan", language: "en", language_name: "English", crop: "alfalfa", crop_raw: null,
    place: { zip: "89406", name: null, country: "US" }, water_cut: true,
    priorities: { water: 0.5, income: 0.25, drought: 0.25 }, option_number: null, source: "rules", ...over,
  };
}

const answer = (body: unknown, status = 200): typeof fetch => async () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("toEngineRequest", () => {
  it("sends the ZIP, the crop and the priorities", () => {
    expect(toEngineRequest(parsed())).toEqual(req);
  });
  it("sends a place name when there is no ZIP", () => {
    expect(toEngineRequest(parsed({ place: { zip: null, name: " Fallon ", country: "US" } }))).toMatchObject({ place: "Fallon" });
  });
  it("leaves out a crop the engine does not know", () => {
    expect(toEngineRequest(parsed({ crop: "dragonfruit" }))).not.toHaveProperty("current_crop");
    expect(ENGINE_CROPS.has("alfalfa")).toBe(true);
  });
  it("is a bad_request when there is nowhere to look up", () => {
    expect(toEngineRequest(parsed({ place: { zip: "12", name: null, country: null } }))).toMatchObject({ error: "bad_request" });
  });
});

describe("callEngine", () => {
  it("posts to /plan with the bearer token and returns the plan", async () => {
    let seen: Request | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      seen = new Request(input as string, init);
      return answer(normal)("");
    };
    const result = await callEngine(env, req, { fetcher });
    expect(seen?.url).toBe("https://engine.example/plan");
    expect(seen?.headers.get("authorization")).toBe("Bearer secret");
    expect(await seen?.json()).toEqual(req);
    expect(result).toEqual(normal);
  });

  it("passes the engine's own errors through", async () => {
    const result = await callEngine(env, req, { fetcher: answer({ error: "field_not_found", message: "no field near 12345" }, 404) });
    expect(result).toEqual({ error: "field_not_found", message: "no field near 12345" });
  });

  it("is engine_failed when not configured, unreachable, slow, or not a plan", async () => {
    expect(await callEngine({} as Env, req)).toMatchObject({ error: "engine_failed" });
    const down: typeof fetch = async () => { throw new TypeError("connection refused"); };
    expect(await callEngine(env, req, { fetcher: down })).toMatchObject({ error: "engine_failed", message: expect.stringContaining("unreachable") });
    const slow: typeof fetch = (_i, init) => new Promise((_, reject) =>
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    expect(await callEngine(env, req, { fetcher: slow, timeoutMs: 20 })).toMatchObject({ error: "engine_failed", message: expect.stringContaining("20 ms") });
    expect(await callEngine(env, req, { fetcher: answer("<html>502</html>", 502) })).toMatchObject({ error: "engine_failed" });
    expect(await callEngine(env, req, { fetcher: answer({ options: [] }) })).toMatchObject({ error: "engine_failed" });
  });
});
