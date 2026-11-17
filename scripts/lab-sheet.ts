/**
 * One picture of a lab test: each source photo on a row, its original first,
 * then every filter's result beside it. For looking at a test with your own
 * eyes instead of trusting the reviewer's numbers.
 *
 *   npm run lab:sheet -- out.jpg [filter,filter,…]
 */
import fs from "node:fs";

for (const line of fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8").split("\n") : []) {
  const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const out = process.argv[2] || "lab-sheet.jpg";
  const only = process.argv[3]?.split(",");
  const { sql, closeDb } = await import("../src/factory/db");
  const { get } = await import("../src/factory/storage");
  const { sharp } = await import("../src/factory/scenes/draw");
  const rows = await sql<{ asset: string; photo: string; filter_id: string; media_key: string }>(
    "select g.asset_id as asset, a.media_key as photo, g.filter_id, g.media_key from generations g join assets a on a.id = g.asset_id where a.meta->>'source' = 'generated' order by g.asset_id, g.created_at",
  );
  const filters = [...new Set(rows.map((r) => r.filter_id))].filter((f) => !only || only.includes(f));
  const assets = [...new Set(rows.map((r) => r.asset))];
  const W = 300, H = 450, gap = 6;
  const layers: { input: Buffer; left: number; top: number }[] = [];
  const cell = async (key: string) => sharp(await get(key)).resize(W, H, { fit: "cover" }).jpeg().toBuffer();
  for (const [y, asset] of assets.entries()) {
    const mine = rows.filter((r) => r.asset === asset);
    layers.push({ input: await cell(mine[0].photo), left: 0, top: y * (H + gap) });
    for (const [x, f] of filters.entries()) {
      const hit = mine.find((r) => r.filter_id === f);
      if (hit) layers.push({ input: await cell(hit.media_key), left: (x + 1) * (W + gap), top: y * (H + gap) });
    }
  }
  await sharp({ create: { width: (filters.length + 1) * (W + gap), height: assets.length * (H + gap), channels: 3, background: "#ffffff" } }).composite(layers).jpeg({ quality: 88 }).toFile(out);
  console.log(`original, ${filters.join(", ")}`);
  await closeDb();
}

main().then(() => process.exit(0), (e) => {
  console.error(e.message);
  process.exit(1);
});
