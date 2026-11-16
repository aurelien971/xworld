/**
 * Gathers what was made elsewhere on this Mac into the factory's library.
 *
 *  1. Opaque Ads' settings, in their own structure, copied as they are into
 *     registry/products/opaque/opaqueads/ (templates, designed templates,
 *     blocks, cloned filters, the caption queue, posts and their numbers).
 *     Sign-in tokens are never copied.
 *  2. Opaque Ads' finished ads (every run's videos and stills), as assets of
 *     kind "ad", with the template, hook and filters each was made from.
 *  3. Portraits made in other apps (the Mitsushiro model work, its catalog),
 *     as source photos waiting for approval. Sheets, frames and screenshots
 *     are left out; the same picture found twice is kept once.
 *
 * Safe to run again. Reads only. The dev server must be stopped.
 *
 *   npm run import:library
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { closeDb, sql } from "../src/factory/db";
import { REGISTRY } from "../src/factory/paths";
import { put } from "../src/factory/storage";

const HOME = os.homedir();
const ADS = path.join(HOME, "OpaqueAds");
const NAT = path.join(HOME, "Desktop/Projects/New Age Technologies");
const walk = (dir: string, out: string[] = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name.startsWith(".")) continue;
    if (f.isDirectory()) walk(path.join(dir, f.name), out);
    else out.push(path.join(dir, f.name));
  }
  return out;
};

async function settings() {
  const to = path.join(REGISTRY, "products/opaque/opaqueads");
  fs.mkdirSync(to, { recursive: true });
  const files = ["templates.json", "designed_templates.json", "blocks.json", "custom_filters.json", "phone_queue.json", "posts.json", "tiktok_metrics.json", "costs.json", "archived_ads.json"];
  let n = 0;
  for (const f of files) {
    if (!fs.existsSync(path.join(ADS, f))) continue;
    fs.copyFileSync(path.join(ADS, f), path.join(to, f));
    n++;
  }
  if (fs.existsSync(path.join(ADS, "Cloner/cloner.json"))) {
    fs.copyFileSync(path.join(ADS, "Cloner/cloner.json"), path.join(to, "cloner.json"));
    n++;
  }
  return n;
}

async function ads() {
  let n = 0;
  for (const run of fs.existsSync(path.join(ADS, "Runs")) ? fs.readdirSync(path.join(ADS, "Runs")) : []) {
    const manifestFile = path.join(ADS, "Runs", run, "manifest.json");
    if (!fs.existsSync(manifestFile)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { createdAt?: string; ads?: { id: string; files: string[]; format?: string; hookId?: string; templateId?: string; endingId?: string; pairIds?: string[] }[] };
    for (const ad of manifest.ads ?? []) {
      for (const [i, rel] of ad.files.entries()) {
        const file = path.join(ADS, "Runs", run, rel);
        if (!fs.existsSync(file)) continue;
        const ext = path.extname(file).toLowerCase();
        const id = `ad-${ad.id.slice(0, 8).toLowerCase()}-${i + 1}`;
        const key = `ads/${run}/${path.basename(file)}`;
        await put(key, fs.readFileSync(file));
        const meta: { width?: number; height?: number } = ext === ".mp4" ? {} : await sharp(file).metadata().catch(() => ({}));
        await sql(
          `insert into assets (id, product, kind, media_key, width, height, tags, meta, approved, created_at)
           values ($1,'opaque','ad',$2,$3,$4,$5,$6,false,$7) on conflict (id) do update set media_key = excluded.media_key, meta = excluded.meta`,
          [id, key, meta.width ?? null, meta.height ?? null, JSON.stringify([ad.format ?? (ext === ".mp4" ? "video" : "still")]),
            JSON.stringify({ source: "opaqueads", run, template: ad.templateId ?? null, hook: ad.hookId ?? null, ending: ad.endingId ?? null, pairs: ad.pairIds ?? [] }), manifest.createdAt ?? new Date().toISOString()],
        );
        n++;
      }
    }
  }
  return n;
}

async function portraits() {
  const sources: [string, string][] = [
    ["mitsushiro-models", path.join(NAT, "Outputs/Models")],
    ["mitsushiro-catalog", path.join(NAT, "Web/Commercial/mitsushiro/media-src/catalog")],
  ];
  const skip = /contact-sheet|frame |settings-preview|text-fit|screenshot|sheet|grid|logo/i;
  const have = new Set((await sql<{ hash: string }>("select meta->>'hash' as hash from assets where meta->>'hash' is not null")).map((r) => r.hash));
  let added = 0, skipped = 0;
  for (const [source, dir] of sources) {
    for (const file of walk(dir)) {
      if (!/\.(jpe?g|png|webp)$/i.test(file) || skip.test(path.basename(file))) continue;
      const data = fs.readFileSync(file);
      const hash = crypto.createHash("sha1").update(data).digest("hex").slice(0, 16);
      if (have.has(hash)) {
        skipped++;
        continue;
      }
      const meta = await sharp(data).metadata().catch(() => null);
      // A portrait: taller than wide, and large enough to post.
      if (!meta?.width || !meta.height || meta.width < 500 || meta.height / meta.width < 1.1 || meta.height / meta.width > 2.2) continue;
      have.add(hash);
      const jpeg = await sharp(data).rotate().resize({ width: 1792, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
      const key = `photos/x-${hash}.jpg`;
      await put(key, jpeg);
      const out = await sharp(jpeg).metadata();
      await sql(
        `insert into assets (id, product, kind, media_key, width, height, tags, meta, approved)
         values ($1,'opaque','photo',$2,$3,$4,$5,$6,false) on conflict (id) do nothing`,
        [`x-${hash}`, key, out.width, out.height, JSON.stringify([meta.height / meta.width > 1.6 ? "full_body" : "portrait"]), JSON.stringify({ source, hash, from: path.relative(NAT, file) })],
      );
      added++;
    }
  }
  return { added, skipped };
}

async function main() {
  console.log("settings files:", await settings());
  console.log("finished ads:", await ads());
  console.log("portraits:", await portraits());
  console.log(await sql("select kind, coalesce(meta->>'source','opaqueads') as source, approved, count(*)::int as n from assets group by 1,2,3 order by 1,2"));
  await closeDb();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
