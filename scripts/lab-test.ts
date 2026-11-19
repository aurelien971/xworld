/**
 * Tests filters from the lab on the factory's own source photos, and keeps
 * everything: each result is a kept generation, each pair is scored by the
 * reviewer, and the Filters page shows what was tested, on what, and how it
 * scored.
 *
 * The source photos are made here from the prompts in
 * registry/products/<product>/sources.json: ordinary phone-style pictures of
 * people who do not exist. No one's real photo is used.
 *
 *   npm run lab -- --filters digicam_2007,night_flash,clean_girl
 *   npm run lab -- --filters all --photos organic-gym-night
 *   npm run lab -- --filters all --rejudge     (score kept results again)
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8").split("\n") : []) {
  const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

type Source = { id: string; tags: string[]; gender?: string; prompt: string };

async function main() {
  const product = arg("product") ?? "opaque";
  const registry = await import("../src/factory/registry");
  const { sql, closeDb } = await import("../src/factory/db");
  const { get, put } = await import("../src/factory/storage");
  const { transform } = await import("../src/factory/stages/transform");
  const { judge } = await import("../src/factory/stages/judge");
  const { openaiKey, generationPaused } = await import("../src/factory/keys");
  if (generationPaused()) throw new Error("Generation is paused (FACTORY_GENERATION=off). Nothing was spent.");
  const { REGISTRY } = await import("../src/factory/paths");
  const { sharp } = await import("../src/factory/scenes/draw");
  if (!openaiKey()) throw new Error("No image model key is set.");

  const lab = registry.lab(product);
  const wanted = (arg("filters") ?? "").split(",").filter(Boolean);
  if (!wanted.length) throw new Error("Say which filters: --filters id,id,… or --filters all.");
  const filters = registry.filters(product).filter((f) => (wanted[0] === "all" ? lab.filters.some((l) => l.id === f.id) : wanted.includes(f.id)));
  const missing = wanted.filter((w) => w !== "all" && !filters.some((f) => f.id === w));
  if (missing.length) throw new Error(`No such filter: ${missing.join(", ")}.`);

  // The source photos: made once from their prompts, then kept in the library like any other photo.
  const all = JSON.parse(fs.readFileSync(path.join(REGISTRY, "products", product, "sources.json"), "utf8")) as Source[];
  const picked = arg("photos") ? all.filter((s) => arg("photos")!.split(",").includes(s.id)) : all;
  const photos: { id: string; key: string }[] = [];
  let spent = 0;
  for (const s of picked) {
    const id = `gen-${s.id}`;
    const [have] = await sql<{ media_key: string }>("select media_key from assets where id = $1", [id]);
    if (have) {
      photos.push({ id, key: have.media_key });
      continue;
    }
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.IMAGE_MODEL || "gpt-image-1.5", prompt: s.prompt, n: 1, size: "1024x1536", quality: "medium", output_format: "jpeg", output_compression: 92 }),
      signal: AbortSignal.timeout(300_000),
    });
    const body = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } } | null;
    const b64 = body?.data?.[0]?.b64_json;
    if (!res.ok || !b64) throw new Error(`The source photo "${s.id}" could not be made: ${body?.error?.message || res.status}`);
    const jpeg = Buffer.from(b64, "base64");
    const meta = await sharp(jpeg).metadata();
    const usd = ((body?.usage?.input_tokens ?? 0) * 5 + (body?.usage?.output_tokens ?? 0) * 10) / 1e6;
    const key = `photos/${id}.jpg`;
    await put(key, jpeg);
    await sql(
      "insert into assets (id, product, kind, media_key, width, height, tags, meta, approved) values ($1,$2,'photo',$3,$4,$5,$6,$7,false) on conflict (id) do nothing",
      [id, product, key, meta.width, meta.height, JSON.stringify(s.tags), JSON.stringify({ source: "generated", gender: s.gender ?? null, prompt: s.prompt })],
    );
    if (usd) await sql("insert into costs (kind, usd, ref) values ('source', $1, $2)", [usd, id]);
    spent += usd;
    photos.push({ id, key });
    console.log(`source  ${s.id}  $${usd.toFixed(3)}`);
  }

  // Every filter's first look on every photo, three at a time. Each is generated once, scored once, and kept.
  const jobs = filters.flatMap((f) => photos.map((p) => ({ f, p })));
  const rows: { filter: string; photo: string; score: number | null; note: string }[] = [];
  const workers = Array.from({ length: 3 }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const { f, p } = job;
      const v = f.variations[0];
      try {
        const g = await transform({ asset: p.id, assetKey: p.key, filter: f.id, variation: v.id, prompt: v.prompt, quality: f.quality });
        // --rejudge: score the pair again, for when the reviewer's instructions have changed.
        if (process.argv.includes("--rejudge")) await sql("delete from judgements where key = $1", [g.key]);
        const review = await judge({ key: g.key, before: await get(p.key), after: await get(g.mediaKey), filterName: f.name, benefit: f.benefit });
        spent += (g.cached ? 0 : (g.costUsd ?? 0)) + review.costUsd;
        rows.push({ filter: f.name, photo: p.id.replace("gen-organic-", ""), score: review.score ?? null, note: `${review.outcome} · realism ${review.realism} alignment ${review.alignment} appeal ${review.appeal}` });
        console.log(`${f.id.padEnd(18)} ${p.id.replace("gen-organic-", "").padEnd(16)} ${String(review.score).padStart(3)}  ${review.outcome}${g.cached ? "  (kept)" : ""}`);
      } catch (e) {
        rows.push({ filter: f.name, photo: p.id, score: null, note: (e as Error).message.slice(0, 160) });
        console.log(`${f.id.padEnd(18)} ${p.id.padEnd(16)} failed: ${(e as Error).message.slice(0, 120)}`);
      }
    }
  });
  await Promise.all(workers);

  console.log("\nBy filter:");
  for (const f of filters) {
    const mine = rows.filter((r) => r.filter === f.name && r.score != null);
    console.log(`${f.name.padEnd(18)} ${mine.length ? Math.round(mine.reduce((n, r) => n + r.score!, 0) / mine.length) : "–"}  (${mine.length}/${photos.length})`);
  }
  console.log(`\nSpent $${spent.toFixed(2)}`);
  await closeDb();
}

main().then(() => process.exit(0), (e) => {
  console.error(e.message);
  process.exit(1);
});
