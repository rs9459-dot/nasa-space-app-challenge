export interface Env {
  /** Workers AI binding: the Llama fallback when Gemini fails. */
  AI: Ai;
  GEMINI_API_KEY: string;
  /** Text model for parsing and writing. */
  GEMINI_MODEL?: string;
  /** Speech model, used for Hindi (Workers AI has no Hindi voice). */
  GEMINI_TTS_MODEL?: string;
  /** Workers AI model used when Gemini is down or refuses. */
  FALLBACK_MODEL?: string;
  /** With both set, every model call goes through Cloudflare AI Gateway (logs, caching). */
  CF_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  /** Only needed when the gateway is set to "authenticated". */
  AI_GATEWAY_TOKEN?: string;
  /** The rotation engine's base URL (a Cloudflare Tunnel address); POST /plan is added. */
  ENGINE_URL?: string;
  /** Bearer token the engine checks; a secret (wrangler secret put / .dev.vars). */
  ENGINE_API_TOKEN?: string;
  /** How long to wait for the engine, in ms (default 6000). */
  ENGINE_TIMEOUT_MS?: string;
  /** "1" enables the /dev/* routes. */
  DEV_ROUTES?: string;
}
