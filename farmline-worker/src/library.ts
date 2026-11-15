// "Ask anything": a small farming library searched with Workers AI embeddings + Cloudflare Vectorize.
// When a farmer texts a question that isn't about a place ("my wheat leaves are turning yellow"),
// FarmLine finds the closest answer by meaning, in any language (bge-m3 is multilingual),
// and replies with that answer and its source. Answers are short, written for FarmLine, and
// name the public body whose guidance they summarise; they are general advice, not a diagnosis.
import type { Env } from "./types";

export interface Entry { id: string; title: string; text: string; source: string }

export const LIBRARY: Entry[] = [
  { id: "yellow-leaves", title: "Yellow leaves", source: "FAO",
    text: "Yellowing that starts on the older, lower leaves is often a sign of low nitrogen. Yellowing on the new top leaves points more to sulfur or iron. First check the field isn't waterlogged, then get a soil test before buying fertilizer." },
  { id: "wilting", title: "Wilting plants", source: "FAO",
    text: "Leaves that droop in the afternoon but recover overnight show mild water stress. If they are still wilted in the morning, the crop needs water urgently." },
  { id: "irrigation-time", title: "Best time to irrigate", source: "FAO",
    text: "Irrigate early in the morning or late in the evening. Less water evaporates, so more reaches the roots. Avoid watering at midday in hot weather." },
  { id: "soil-moisture", title: "Checking soil moisture by hand", source: "USDA NRCS",
    text: "Squeeze a handful of soil from root depth. If it crumbles and won't hold a shape, it is too dry. If it forms a ball that breaks when pressed, moisture is fine. If water drips out, it is too wet." },
  { id: "mulch", title: "Mulching to keep soil moist", source: "FAO",
    text: "Cover the soil with straw or crop residue. Mulch keeps the soil cooler, cuts evaporation so moisture lasts longer between rains, and slows weeds." },
  { id: "drip", title: "Drip irrigation", source: "FAO",
    text: "Drip irrigation puts water right at the roots and uses much less water than flooding a field. It suits vegetables, fruit trees and cotton. Ask your agriculture office about subsidy schemes." },
  { id: "rice-awd", title: "Saving water in rice", source: "IRRI",
    text: "Try alternate wetting and drying: let the water in the rice field drop just below the soil surface before flooding again. Keep the field flooded around flowering. Done right, it saves water without lowering yield." },
  { id: "drought-crops", title: "Crops that handle drought", source: "ICRISAT",
    text: "In dry areas, sorghum, pearl millet, chickpea, pigeon pea and cowpea cope with drought better than rice, sugarcane or maize." },
  { id: "legume-rotation", title: "Rotating with legumes", source: "FAO",
    text: "Rotating cereals with legumes such as beans, chickpea or lentil adds nitrogen to the soil and breaks pest cycles, so the next cereal crop often needs less fertilizer." },
  { id: "intercrop", title: "Intercropping to spread risk", source: "CIMMYT",
    text: "Growing a legume between cereal rows, such as maize with beans, spreads risk: if one crop fails in a drought, the other may still give a harvest." },
  { id: "wheat-sowing", title: "When to sow wheat in north India", source: "ICAR",
    text: "In north India, wheat is usually sown from early to mid November. Late sowing puts grain filling into the hot season, which lowers yield. If you sow late, choose a heat-tolerant variety." },
  { id: "maize-planting", title: "When to plant maize", source: "CIMMYT",
    text: "Plant maize once the rains have properly started and the topsoil is moist, not after the first light shower. Seed planted into dry soil often fails to come up." },
  { id: "armyworm", title: "Fall armyworm in maize", source: "FAO",
    text: "Fall armyworm chews ragged holes in maize leaves and leaves sawdust-like droppings in the funnel of the plant. Check plants every week and crush egg masses and young caterpillars early. Ask your extension office before spraying." },
  { id: "locust", title: "Locusts", source: "FAO",
    text: "If you see locust swarms or hopper bands, report them to your national plant protection or agriculture office right away. Control works best when it starts early." },
  { id: "pest-scouting", title: "Watching for pests", source: "FAO",
    text: "Walk your field every week and check the underside of leaves. Act when a pest is clearly spreading, not at the first insect: many insects are harmless or eaten by others." },
  { id: "heat-flowering", title: "Heat waves at flowering", source: "CIMMYT",
    text: "Heat hurts yield most when the crop is flowering. If a heat wave is coming, a light irrigation just before it cools the crop and protects the flowers." },
  { id: "fertilizer-rain", title: "Fertilizer and rain", source: "FAO",
    text: "Don't spread fertilizer just before heavy rain: much of it washes away. Apply it when the soil is moist and only light rain is expected." },
  { id: "soil-test", title: "Soil testing", source: "FAO",
    text: "A soil test shows which nutrients your field lacks, so you buy only the fertilizer you need. Many governments offer free or cheap testing, such as the Soil Health Card scheme in India." },
  { id: "compost", title: "Compost and manure", source: "FAO",
    text: "Compost and manure add organic matter, which helps soil hold water and nutrients. Mix them into the soil before planting instead of leaving them on the surface in the sun." },
  { id: "salinity", title: "Salty soil", source: "FAO",
    text: "A white crust on the soil and stunted plants with burnt leaf tips can mean salty soil. Use the best water you have, keep the field level so water spreads evenly, and choose salt-tolerant crops such as barley or cotton." },
  { id: "waterlogging", title: "Waterlogged fields", source: "FAO",
    text: "Water standing for days starves roots of air and turns leaves yellow. Open drainage channels and don't irrigate again until the soil has drained." },
  { id: "storage", title: "Storing grain and seed", source: "FAO",
    text: "Store grain and seed dry, cool and sealed. Damp grain grows mould. Airtight storage bags keep insects out without chemicals." },
  { id: "sugarcane-water", title: "Saving water in sugarcane", source: "ICAR",
    text: "Sugarcane needs a lot of water. Drip irrigation, covering the soil with cane trash, and watering alternate furrows all cut water use." },
  { id: "alfalfa-drought", title: "Alfalfa in a drought", source: "University of California ANR",
    text: "In a drought, give your water to the early cuttings, which yield the most. Alfalfa can survive stopping irrigation in late summer: it goes dormant and usually recovers when water returns." },
  { id: "nasa-power", title: "Where FarmLine's weather comes from", source: "NASA POWER",
    text: "FarmLine's rain and temperature come from NASA POWER, which combines satellite observations and weather models for any point on Earth. The normal is the long-term average for the same days of the year." },
  { id: "percent-normal", title: "What % of normal means", source: "NASA POWER",
    text: "Rain as a % of normal compares your last 30 days with the long-term average for the same time of year. Under 50% is a dry spell. Over 120% is wetter than usual." },
  { id: "alerts", title: "Drought alerts", source: "FarmLine",
    text: "Reply ALERT and FarmLine checks NASA rain for your area every day and texts you when a dry spell starts. Reply STOP to stop all messages." },
  { id: "how-to-ask", title: "How to use FarmLine", source: "FarmLine",
    text: "Text your crop and your ZIP code, PIN code or town, for example: wheat 141001. FarmLine replies with NASA rain for your area and crop plans." },
];

const MODEL = "@cf/baai/bge-m3"; // multilingual embeddings, 1024 dimensions
const VERSION = `v1-${LIBRARY.length}`; // bump to re-index after editing the library
const MIN_SCORE = 0.55; // bge-m3 cosine score below which an answer isn't close enough to send

async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const out = (await env.AI!.run(MODEL as any, { text: texts })) as { data?: number[][] };
  return out.data ?? [];
}

/** Put the library into Vectorize. Runs once per library version (remembered in KV), or on demand from /admin. */
export async function indexLibrary(env: Env, force = false): Promise<number[][] | null> {
  if (!env.AI || !env.KB) return null;
  const flag = `library:indexed:${VERSION}`;
  if (!force && env.CACHE && (await env.CACHE.get(flag))) return null;
  const vectors = await embed(env, LIBRARY.map((e) => `${e.title}. ${e.text}`));
  await env.KB.upsert(LIBRARY.map((e, i) => ({ id: e.id, values: vectors[i], metadata: { title: e.title, source: e.source } })));
  await env.CACHE?.put(flag, new Date().toISOString());
  return vectors;
}

const cosine = (a: number[], b: number[]) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na * nb) || 1);
};

export interface LibraryHit { id: string; title: string; source: string; score: number }

/** Closest library answer to a farmer's question, or null if nothing is close enough. */
export async function askLibrary(env: Env, question: string): Promise<{ entry: Entry | null; hits: LibraryHit[]; ms: number }> {
  const t = Date.now();
  if (!env.AI || !env.KB) return { entry: null, hits: [], ms: 0 };
  try {
    const fresh = await indexLibrary(env);
    const [v] = await embed(env, [question]);
    if (!v) return { entry: null, hits: [], ms: Date.now() - t };
    // Right after indexing, Vectorize needs a few seconds before new vectors are searchable: match in memory that one time.
    const matches = fresh
      ? LIBRARY.map((e, i) => ({ id: e.id, score: cosine(v, fresh[i]) })).sort((a, b) => b.score - a.score).slice(0, 3)
      : ((await env.KB.query(v, { topK: 3, returnMetadata: "all" })).matches ?? []);
    const hits: LibraryHit[] = matches.map((m) => {
      const e = LIBRARY.find((x) => x.id === m.id);
      return { id: m.id, title: e?.title ?? m.id, source: e?.source ?? "", score: Math.round(m.score * 1000) / 1000 };
    });
    const top = hits[0];
    const min = Number(env.LIBRARY_MIN_SCORE) || MIN_SCORE;
    const entry = top && top.score >= min ? LIBRARY.find((e) => e.id === top.id) ?? null : null;
    return { entry, hits, ms: Date.now() - t };
  } catch (e) {
    console.error("library search failed", e);
    return { entry: null, hits: [], ms: Date.now() - t };
  }
}

/** The SMS a farmer gets for a library answer (English; translated like every other reply). */
export const libraryReply = (e: Entry) => `FarmLine: ${e.text}\nSource: ${e.source}. General advice; check with your local agriculture office.\nText your crop and town for NASA rain in your area.`;
