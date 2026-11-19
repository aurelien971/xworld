import { generationPaused, openaiKey } from "../keys";
import crypto from "node:crypto";
import { sql } from "../db";
import { sharp } from "../scenes/draw";
import { get, put } from "../storage";

/**
 * A filter applied to a photo: the same call, framing rule and padding as the
 * Opaque app, so a post shows what a user would get. Every result is kept by
 * photo, filter, variation and prompt; asking twice costs nothing.
 */
export const promptHash = (prompt: string) => crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 12);
export const generationKey = (asset: string, filter: string, variation: string, prompt: string) => `${asset}|${filter}|${variation}|${promptHash(prompt)}`;

export type Generation = { key: string; mediaKey: string; costUsd: number | null; source: string; cached: boolean };

const framed = (instructions: string) =>
  `Edit the provided photograph according to these instructions: ${instructions}. ` +
  "The output MUST be a single photorealistic photograph. Preserve the EXACT same framing, aspect ratio, dimensions, composition, camera angle, zoom level, and subject proportions as the input — do not crop, zoom, pan, rotate, reframe, stretch, or recompose in any way. Preserve the subject's identity, face, body proportions, skin texture, materials, and lighting. Do NOT cartoonify, illustrate, paint, over-smooth, or stylize unless explicitly asked. Apply ONLY the requested change and keep everything else identical. Maximize sharpness and fine detail; the result must look like a real, unedited photograph.";

/** The edits endpoint only returns 1:1, 3:2 or 2:3: pad to the nearest, and cut the padding back off the result. */
async function prepare(image: Buffer) {
  const base = sharp(image).rotate().resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true });
  const { data, info } = await base.jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
  const aspect = info.width / info.height;
  const options: [string, number][] = [["1024x1024", 1], ["1536x1024", 1.5], ["1024x1536", 1 / 1.5]];
  const [size, target] = options.reduce((a, b) => (Math.abs(b[1] - aspect) < Math.abs(a[1] - aspect) ? b : a));
  if (Math.abs(aspect - target) < 0.02) return { upload: data, size, crop: null };
  const cw = Math.round(target >= 1 ? 1536 : 1536 * target), ch = Math.round(target >= 1 ? 1536 / target : 1536);
  const fit = Math.min(cw / info.width, ch / info.height);
  const dw = Math.round(info.width * fit), dh = Math.round(info.height * fit);
  const ox = Math.round((cw - dw) / 2), oy = Math.round((ch - dh) / 2);
  const upload = await sharp({ create: { width: cw, height: ch, channels: 3, background: "#000000" } })
    .composite([{ input: await sharp(data).resize(dw, dh).toBuffer(), left: ox, top: oy }])
    .jpeg({ quality: 92 })
    .toBuffer();
  return { upload, size, crop: { x: ox / cw, y: oy / ch, w: dw / cw, h: dh / ch } };
}

type Usage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { image_tokens?: number; text_tokens?: number; cached_image_tokens?: number; cached_text_tokens?: number } };
/** gpt-image-1.5, per million tokens: image in $8, text in $5, cached $1.25, out $10. */
function price(u?: Usage) {
  if (!u) return null;
  const d = u.input_tokens_details ?? {};
  const img = d.image_tokens ?? 0, txt = d.text_tokens ?? 0, cImg = d.cached_image_tokens ?? 0, cTxt = d.cached_text_tokens ?? 0, out = u.output_tokens ?? 0;
  let usd = (Math.max(0, img - cImg) * 8 + Math.max(0, txt - cTxt) * 5 + (cImg + cTxt) * 1.25 + out * 10) / 1e6;
  if (!img && !txt && u.input_tokens) usd = (u.input_tokens * 8 + out * 10) / 1e6;
  return usd > 0 ? usd : null;
}

export async function cached(key: string): Promise<Generation | null> {
  const [row] = await sql<{ key: string; media_key: string; cost_usd: string | null; source: string }>("select key, media_key, cost_usd, source from generations where key = $1", [key]);
  return row ? { key: row.key, mediaKey: row.media_key, costUsd: row.cost_usd == null ? null : Number(row.cost_usd), source: row.source, cached: true } : null;
}

export async function transform(o: { asset: string; assetKey: string; filter: string; variation: string; prompt: string; quality: string }): Promise<Generation> {
  const key = generationKey(o.asset, o.filter, o.variation, o.prompt);
  const hit = await cached(key);
  if (hit) return hit;

  if (generationPaused()) throw new Error("Generation is paused, so this pair was not made. Nothing was spent.");
  const apiKey = openaiKey();
  if (!apiKey) throw new Error("This pair has not been generated yet and no image model key is set.");
  const prepared = await prepare(await get(o.assetKey));
  const form = new FormData();
  form.set("model", process.env.IMAGE_MODEL || "gpt-image-1.5");
  form.set("prompt", framed(o.prompt));
  form.set("n", "1");
  form.set("size", prepared.size);
  form.set("quality", o.quality || "medium");
  form.set("input_fidelity", "high");
  form.set("output_format", "jpeg");
  form.set("output_compression", "90");
  form.set("moderation", "auto");
  form.set("image", new Blob([new Uint8Array(prepared.upload)], { type: "image/jpeg" }), "base.jpg");
  const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(300_000) });
  const body = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[]; usage?: Usage; error?: { message?: string } } | null;
  if (!res.ok) throw new Error(body?.error?.message || `The image model answered ${res.status}.`);
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) throw new Error("The image model returned no picture.");

  let out = Buffer.from(b64, "base64");
  if (prepared.crop) {
    const meta = await sharp(out).metadata();
    const W = meta.width!, H = meta.height!;
    out = await sharp(out).extract({ left: Math.round(prepared.crop.x * W), top: Math.round(prepared.crop.y * H), width: Math.round(prepared.crop.w * W), height: Math.round(prepared.crop.h * H) }).jpeg({ quality: 92 }).toBuffer();
  }
  const meta = await sharp(out).metadata();
  const usd = price(body?.usage);
  const mediaKey = `generations/${o.asset}_${o.filter}_${o.variation}_${promptHash(o.prompt)}.jpg`;
  await put(mediaKey, out);
  await sql(
    "insert into generations (key, asset_id, filter_id, variation_id, prompt_hash, media_key, width, height, cost_usd, source) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'factory') on conflict (key) do nothing",
    [key, o.asset, o.filter, o.variation, promptHash(o.prompt), mediaKey, meta.width, meta.height, usd],
  );
  if (usd) await sql("insert into costs (kind, usd, ref) values ('generation', $1, $2)", [usd, key]);
  return { key, mediaKey, costUsd: usd, source: "factory", cached: false };
}
