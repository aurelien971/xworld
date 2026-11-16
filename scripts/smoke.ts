/** A quick end-to-end check from the terminal: plan a day, optionally run it, print where each brief landed. The dev server must be stopped. */
import { briefsOn } from "../src/factory/briefs";
import { closeDb, sql } from "../src/factory/db";
import { runDay } from "../src/factory/pipeline";
import { planDay } from "../src/factory/planner";
import { dayOf } from "../src/factory/time";

async function main() {
  const day = process.argv[2] || dayOf();
  const mode = process.argv[3];
  if (mode === "reset") await sql("delete from events where brief_id in (select id from briefs where day = $1)", [day]).then(() => sql("delete from briefs where day = $1", [day]));
  console.log(await planDay("opaque", day));
  if (mode === "run" || mode === "reset") await runDay("opaque", day);
  for (const b of await briefsOn("opaque", day)) console.log(b.id, b.state.padEnd(10), `${b.inputs.filter}/${b.inputs.variation}`.padEnd(28), String(b.review?.score ?? "-").padEnd(4), b.review ? `r${b.review.realism} a${b.review.alignment} p${b.review.appeal}` : "", b.review?.note ?? b.error ?? "");
  console.log(await sql("select kind, count(*)::int n, sum(usd)::float usd from costs group by 1"));
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
