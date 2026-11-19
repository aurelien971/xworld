/**
 * Lays every finished, approved post out on a calendar and writes it to a
 * folder: one folder per post with its files and its caption, and one
 * manifest that says what goes out when and where. Nothing is generated and
 * nothing is posted; this is the hand-over to whatever does the posting.
 *
 *   npm run export -- --from 2026-11-20 --per-day 4 [--approve-held]
 *
 * --approve-held  first approves the posts still waiting for review.
 * Times are local to the posting tool (Europe/London). Formats are mixed
 * through the days so a day is never four of the same thing.
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
const TIMES = ["09:00", "13:00", "18:00", "21:00", "11:00", "15:30", "20:00", "22:30"];

async function main() {
  const product = arg("product") ?? "opaque";
  const from = arg("from") ?? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const perDay = Math.max(1, Math.min(TIMES.length, Number(arg("per-day") ?? 4)));
  const registry = await import("../src/factory/registry");
  const { sql, closeDb } = await import("../src/factory/db");
  const { get } = await import("../src/factory/storage");
  const { allBriefs } = await import("../src/factory/briefs");
  const { reviewBrief } = await import("../src/factory/pipeline");
  const { DATA } = await import("../src/factory/paths");

  if (process.argv.includes("--approve-held")) {
    const held = await sql<{ id: string }>("select id from briefs where product = $1 and state = 'reviewing' and jsonb_array_length(slides) > 0", [product]);
    for (const { id } of held) await reviewBrief(id, true);
    console.log(`approved ${held.length} waiting posts`);
  }

  const ready = (await allBriefs(product, 2000)).filter((b) => b.state === "ready" && b.slides.length > 0 && !b.publish?.ref);
  const tags = registry.product(product).hashtags.map((t) => `#${t.replace(/^#/, "")}`).join(" ");
  const kind = (b: (typeof ready)[number]) => (b.video ? "video" : b.slides.length > 1 ? "carousel" : "picture");

  // Mix the kinds: always take next from the kind that is furthest behind its share.
  const piles = { video: ready.filter((b) => kind(b) === "video"), carousel: ready.filter((b) => kind(b) === "carousel"), picture: ready.filter((b) => kind(b) === "picture") };
  const totals = Object.fromEntries(Object.entries(piles).map(([k, v]) => [k, v.length])) as Record<keyof typeof piles, number>;
  const order: typeof ready = [];
  while (order.length < ready.length) {
    const next = (Object.keys(piles) as (keyof typeof piles)[]).filter((k) => piles[k].length).sort((a, b) => piles[b].length / totals[b] - piles[a].length / totals[a])[0];
    order.push(piles[next].shift()!);
  }

  const root = path.join(DATA, "export", `${product}-${from}`);
  fs.mkdirSync(root, { recursive: true });
  const manifest: unknown[] = [];
  for (const [i, b] of order.entries()) {
    const day = new Date(Date.parse(`${from}T12:00:00Z`) + Math.floor(i / perDay) * 86_400_000).toISOString().slice(0, 10);
    const time = TIMES[i % perDay];
    const k = kind(b);
    // Where each kind can go: a short video everywhere; pictures to the picture platforms.
    const platforms = k === "video" ? ["instagram", "tiktok", "youtube", "x"] : ["instagram", "tiktok", "x"];
    const dir = path.join(root, day, `${time.replace(":", "")} ${k} ${b.format} ${b.id}`);
    fs.mkdirSync(dir, { recursive: true });
    const files: string[] = [];
    if (b.video) {
      fs.writeFileSync(path.join(dir, "video.mp4"), await get(b.video.key));
      fs.writeFileSync(path.join(dir, "cover.jpg"), await get(b.slides[0].key));
      files.push("video.mp4");
    } else {
      for (const [n, s] of b.slides.entries()) {
        fs.writeFileSync(path.join(dir, `${n + 1}.jpg`), await get(s.key));
        files.push(`${n + 1}.jpg`);
      }
    }
    const caption = `${(b.caption ?? "").trim()}${tags ? `\n\n${tags}` : ""}`;
    fs.writeFileSync(path.join(dir, "caption.txt"), caption);
    manifest.push({ n: i + 1, id: b.id, day, time, kind: k, format: b.format, platforms, seconds: b.video?.seconds ?? null, dir: path.relative(root, dir), files, cover: b.video ? "cover.jpg" : null, caption });
    if ((i + 1) % 10 === 0) console.log(`written ${i + 1}/${order.length}`);
  }
  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
  const days = Math.ceil(order.length / perDay);
  console.log(`${order.length} posts over ${days} days from ${from}, ${perDay} a day (${totals.video} videos, ${totals.carousel} carousels, ${totals.picture} pictures)\n${root}`);
  await closeDb();
}

main().then(() => process.exit(0), (e) => {
  console.error(e.message);
  process.exit(1);
});
