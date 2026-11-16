/**
 * One-time import from the Opaque Ads Mac app: the filter catalog, the tagged
 * photo library, every cached generation and the validated hooks. Safe to run
 * again; nothing is duplicated. Reads only, never writes to ~/OpaqueAds.
 *
 *   npm run import:opaqueads
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { closeDb, sql } from "../src/factory/db";
import { REGISTRY } from "../src/factory/paths";
import { put } from "../src/factory/storage";
import type { Filter } from "../src/factory/types";

const HOME = process.env.OPAQUEADS_HOME || path.join(os.homedir(), "OpaqueAds");
const APP = process.env.OPAQUEADS_APP || path.join(os.homedir(), "Desktop/Projects/New Age Technologies/Apps/Mac OS/For Me/Opaqueads/Opaqueads");
const json = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(HOME, file), "utf8"));

/** A Swift string literal's value. */
const unswift = (s: string) => s.replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\n/g, "\n").replace(/\\(["'\\])/g, "$1");
const STR = `"((?:[^"\\\\]|\\\\.)*)"`;

/** The 30-odd coded filters in Shared/StudioVariation.swift. */
function studioFilters(): Filter[] {
  const src = fs.readFileSync(path.join(APP, "Shared/StudioVariation.swift"), "utf8");
  const head = new RegExp(`StudioFilter\\(\\s*id:\\s*${STR},\\s*category:\\s*${STR},\\s*name:\\s*${STR},\\s*benefit:\\s*${STR},\\s*quality:\\s*${STR}`, "g");
  const variation = new RegExp(`StudioVariation\\(\\s*id:\\s*${STR},\\s*label:\\s*${STR},\\s*prompt:\\s*${STR}\\s*\\)`, "g");
  const heads = [...src.matchAll(head)];
  return heads.map((m, i) => {
    const body = src.slice(m.index! + m[0].length, heads[i + 1]?.index ?? src.length);
    const variations = [...body.matchAll(variation)].map((v) => ({ id: unswift(v[1]), label: unswift(v[2]), prompt: unswift(v[3]) }));
    return { id: unswift(m[1]), category: unswift(m[2]), name: unswift(m[3]), benefit: unswift(m[4]), quality: unswift(m[5]), approved: false, origin: "opaque" as const, variations };
  }).filter((f) => f.variations.length);
}

type Preset = { id: string; category: string; name: string; benefit?: string; quality?: string; basePrompt?: string; intensities?: { id: string; label: string; prompt: string }[] };
const fromPreset = (p: Preset): Filter | null => {
  const variations = p.intensities?.length ? p.intensities : p.basePrompt ? [{ id: "default", label: p.name, prompt: p.basePrompt }] : [];
  return variations.length ? { id: p.id, category: p.category, name: p.name, benefit: p.benefit ?? "", quality: p.quality ?? "medium", approved: false, origin: "opaque" as const, variations } : null;
};

async function main() {
  // Filters: the iOS seed, then the coded studio catalog (it wins on a shared id), then cloned filters.
  const seed = (JSON.parse(fs.readFileSync(path.join(APP, "Resources/prompt_library.json"), "utf8")) as { presets: Preset[] }).presets;
  const custom = fs.existsSync(path.join(HOME, "custom_filters.json")) ? json<{ preset: Preset }[]>("custom_filters.json").map((c) => c.preset) : [];
  const blocks = json<{ approved: string[]; approvedAssets: string[]; hooks: { id: string; text: string; validated: boolean }[] }>("blocks.json");
  const byId = new Map<string, Filter>();
  for (const f of [...seed.map(fromPreset), ...studioFilters(), ...custom.map(fromPreset)]) if (f) byId.set(f.id, f);
  const filters = [...byId.values()].map((f) => ({ ...f, approved: blocks.approved.includes(f.id) }));
  fs.writeFileSync(path.join(REGISTRY, "products/opaque/filters.json"), JSON.stringify(filters, null, 2) + "\n");

  // Hooks: only the text and whether it was validated in the app.
  const hooks = blocks.hooks.map((h) => ({ id: h.id.slice(0, 8).toLowerCase(), text: h.text, validated: h.validated }));
  fs.writeFileSync(path.join(REGISTRY, "angles/opaque.json"), JSON.stringify({ product: "opaque", hooks, captionLine: "{hook}\n{filter} in Opaque." }, null, 2) + "\n");

  // Photos.
  type Photo = { id: string; filename: string; tags: string[]; gender?: string; width: number; height: number; addedAt: string };
  const photos = json<Photo[]>("library.json");
  let photoCount = 0;
  for (const p of photos) {
    const file = path.join(HOME, "Images", p.filename);
    if (!fs.existsSync(file)) continue;
    const data = fs.readFileSync(file);
    const meta = await sharp(data).metadata();
    const key = `photos/${p.id}${path.extname(p.filename).toLowerCase() || ".jpg"}`;
    await put(key, data);
    await sql(
      `insert into assets (id, product, kind, media_key, width, height, tags, meta, approved, created_at)
       values ($1,'opaque','photo',$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set media_key = excluded.media_key, width = excluded.width, height = excluded.height, tags = excluded.tags, meta = excluded.meta, approved = excluded.approved`,
      [p.id, key, meta.width, meta.height, JSON.stringify(p.tags), JSON.stringify({ gender: p.gender ?? null, source: "opaqueads" }), blocks.approvedAssets.includes(p.id), p.addedAt],
    );
    photoCount++;
  }

  // Cached generations, with what each cost when it was made (the cost log's average for its filter, when it has one).
  type Gen = { assetId: string; filterId: string; variationId: string; promptHash: string; file: string; createdAt: string };
  const costs = json<{ filterId: string; variationId?: string; usd: number }[]>("costs.json");
  const mean = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  const costOf = (g: Gen) => mean(costs.filter((c) => c.filterId === g.filterId && c.variationId === g.variationId).map((c) => c.usd)) ?? mean(costs.filter((c) => c.filterId === g.filterId).map((c) => c.usd));
  const gens = json<Record<string, Gen>>("generated_index.json");
  let genCount = 0;
  for (const [key, g] of Object.entries(gens)) {
    const file = path.join(HOME, "Generated", g.file);
    if (!fs.existsSync(file)) continue;
    const data = fs.readFileSync(file);
    const meta = await sharp(data).metadata();
    const mediaKey = `generations/${g.file}`;
    await put(mediaKey, data);
    await sql(
      `insert into generations (key, asset_id, filter_id, variation_id, prompt_hash, media_key, width, height, cost_usd, source, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'opaqueads',$10) on conflict (key) do nothing`,
      [key, g.assetId, g.filterId, g.variationId, g.promptHash, mediaKey, meta.width, meta.height, costOf(g), g.createdAt],
    );
    genCount++;
  }

  console.log(`filters ${filters.length} (${filters.filter((f) => f.approved).length} approved) · hooks ${hooks.length} · photos ${photoCount} · generations ${genCount}`);
  await closeDb();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
