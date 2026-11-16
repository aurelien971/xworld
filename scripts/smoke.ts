/**
 * A quick end-to-end check from the terminal: plan a day, optionally run it, print where each brief landed.
 * The dev server must be stopped (or DATABASE_URL set).
 *
 *   npm run smoke -- 2026-11-20 run            plan and run that day
 *   npm run smoke -- 2026-11-20 reset          delete the day, then plan and run it
 *   npm run smoke -- 2026-11-20 run sample     first approve a spread of ideas, for a first look at every format
 */
import { briefsOn } from "../src/factory/briefs";
import { closeDb, sql } from "../src/factory/db";
import { runDay } from "../src/factory/pipeline";
import { planDay } from "../src/factory/planner";
import * as registry from "../src/factory/registry";
import { dayOf } from "../src/factory/time";

async function main() {
  const day = process.argv[2] || dayOf();
  const mode = process.argv[3];
  if (process.argv[4] === "sample") {
    const seen = new Map<string, number>();
    let n = 0;
    for (const idea of registry.ideas("opaque")) {
      const key = idea.persona + ":" + idea.format;
      if ((seen.get(idea.format) ?? 0) >= 3 || seen.has(key)) continue;
      seen.set(idea.format, (seen.get(idea.format) ?? 0) + 1);
      seen.set(key, 1);
      await sql("insert into idea_state (id, state) values ($1,'approved') on conflict (id) do nothing", [idea.id]);
      n++;
    }
    console.log("approved a sample of", n, "ideas");
  }
  if (mode === "reset") await sql("delete from events where brief_id in (select id from briefs where day = $1)", [day]).then(() => sql("delete from briefs where day = $1", [day]));
  console.log(await planDay("opaque", day));
  const started = Date.now();
  if (mode === "run" || mode === "reset") await runDay("opaque", day);
  for (const b of await briefsOn("opaque", day)) {
    const made = b.video ? b.video.seconds + "s video" : b.slides.length + " slides";
    console.log(b.id.slice(-2), b.state.padEnd(10), b.persona.padEnd(17), b.format.padEnd(22), String(1 + (b.inputs.more?.length ?? 0)) + "p", made.padEnd(11), b.inputs.idea ? "idea" : "hook", b.error ?? "");
  }
  console.log(Math.round((Date.now() - started) / 1000) + "s");
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
