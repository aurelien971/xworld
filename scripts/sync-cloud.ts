/**
 * Copies this Mac's factory up to the cloud: every table and every media
 * file, from /data to Postgres and the Blob store. Run it once after the
 * database is connected (and again whenever local work should be published
 * up). Rows that already exist are left as they are; media is overwritten.
 *
 *   npm run sync:cloud        (the dev server must be stopped)
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8").split("\n") : []) {
  const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const token = process.env.BLOB_READ_WRITE_TOKEN;

const TABLES: [string, string][] = [["assets", "id"], ["generations", "key"], ["judgements", "key"], ["alignments", "key"], ["briefs", "id"], ["persona_links", "persona"], ["events", "id"], ["costs", "id"]];
const JSONB = new Set(["tags", "meta", "inputs", "slides", "video", "align", "review", "publish", "metrics", "result"]);

async function main() {
  if (!url || !token) throw new Error("Set DATABASE_URL and BLOB_READ_WRITE_TOKEN first (connect the database in Vercel, then `vercel env pull .env.local`).");
  // Read everything from the local database first, then open the cloud one for writing.
  delete process.env.DATABASE_URL;
  const local = await import("../src/factory/db");
  const rows = new Map<string, Record<string, unknown>[]>();
  for (const [table] of TABLES) rows.set(table, await local.sql("select * from " + table));
  await local.closeDb();

  process.env.DATABASE_URL = url;
  const cloud = await import("../src/factory/db");
  for (const [table, key] of TABLES) {
    const list = rows.get(table)!;
    for (const row of list) {
      const cols = Object.keys(row);
      const values = cols.map((c) => (JSONB.has(c) && row[c] != null ? JSON.stringify(row[c]) : row[c]));
      const marks = cols.map((_, i) => "$" + (i + 1)).join(",");
      await cloud.sql("insert into " + table + " (" + cols.join(",") + ") values (" + marks + ") on conflict (" + key + ") do nothing", values);
    }
    console.log(table + ": " + list.length);
  }
  await cloud.sql("select setval(pg_get_serial_sequence('events','id'), coalesce((select max(id) from events), 1))");
  await cloud.sql("select setval(pg_get_serial_sequence('costs','id'), coalesce((select max(id) from costs), 1))");

  const { put } = await import("@vercel/blob");
  const { MEDIA } = await import("../src/factory/paths");
  const { contentType } = await import("../src/factory/storage");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.isDirectory()) walk(path.join(dir, f.name));
      else files.push(path.join(dir, f.name));
    }
  };
  walk(MEDIA);
  let done = 0;
  const workers = Array.from({ length: 8 }, async () => {
    for (let f = files.pop(); f; f = files.pop()) {
      const key = path.relative(MEDIA, f).split(path.sep).join("/");
      await put(key, fs.readFileSync(f), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: contentType(key), token });
      if (++done % 50 === 0) console.log("media: " + done);
    }
  });
  await Promise.all(workers);
  console.log("media: " + done + " files");
  await cloud.closeDb();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
