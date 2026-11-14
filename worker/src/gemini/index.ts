/**
 * FarmLine's Gemini layer. What the rest of the Worker calls:
 *
 *   const parsed = await parseMessage(env, smsBody, { country });     // text -> JSON for the engine
 *   const result = await callEngine(parsed);                           // Lane A
 *   const reply  = await composeReply(env, result, { language: parsed.language,
 *                    language_name: parsed.language_name, channel: "sms",
 *                    option_number: parsed.option_number });           // JSON -> checked words
 *   const audio  = await speak(env, reply.text);                       // Hindi voice (WAV)
 */
export { parseMessage, parseByRules, type ParsedMessage, type ParseHints, type Priorities } from "./parse";
export { composeReply, MAX_SMS_SEGMENTS, type Reply, type ReplyRequest } from "./reply";
export { speak, pcmToWav, type Speech } from "./tts";
export { checkNumbers, extractNumbers } from "./numbers";
export { smsInfo, toGsmFriendly } from "./sms";
export { renderPlan, renderOptionDetail, renderError, type Channel } from "./templates";
export type { EngineResult, EngineError, RotationOption, OptionLabel } from "./engine-types";
export type { Lang, BuiltInLang } from "./languages";
