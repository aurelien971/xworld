import { sql } from "./db";
import type { Brief, BriefEvent, State } from "./types";

type Row = {
  id: string; day: string; seq: number; product: string; persona: string; account: string; format: string;
  inputs: Brief["inputs"]; state: State; error: string | null; caption: string | null; slides: Brief["slides"];
  review: Brief["review"]; publish: Brief["publish"]; metrics: Brief["metrics"]; cost_usd: string;
  created_at: Date | string; updated_at: Date | string;
};
const iso = (d: Date | string) => new Date(d).toISOString();
const COLS = "id, day::text as day, seq, product, persona, account, format, inputs, state, error, caption, slides, review, publish, metrics, cost_usd, created_at, updated_at";
const toBrief = (r: Row): Brief => ({
  id: r.id, day: r.day, seq: r.seq, product: r.product, persona: r.persona, account: r.account, format: r.format,
  inputs: r.inputs, state: r.state, error: r.error, caption: r.caption, slides: r.slides ?? [], review: r.review, publish: r.publish, metrics: r.metrics,
  costUsd: Number(r.cost_usd), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

export const briefsOn = async (product: string, day: string) => (await sql<Row>(`select ${COLS} from briefs where product = $1 and day = $2 order by seq`, [product, day])).map(toBrief);
/** Every brief of a product, newest day first, for the wall. */
export const allBriefs = async (product: string, limit = 600) => (await sql<Row>(`select ${COLS} from briefs where product = $1 order by day desc, seq limit $2`, [product, limit])).map(toBrief);
export const brief = async (id: string) => {
  const [row] = await sql<Row>(`select ${COLS} from briefs where id = $1`, [id]);
  return row ? toBrief(row) : null;
};
export const eventsOf = async (id: string) =>
  (await sql<{ at: Date; state: State; note: string | null }>("select at, state, note from events where brief_id = $1 order by id", [id])).map((e): BriefEvent => ({ at: iso(e.at), state: e.state, note: e.note }));

const JSON_FIELDS = new Set(["slides", "review", "publish", "metrics", "inputs"]);
const COLUMN: Record<string, string> = { costUsd: "cost_usd" };

/** Move a brief to a state (or keep it), with what changed and a line for its history. */
export async function update(id: string, state: State | null, note: string | null, patch: Partial<Pick<Brief, "error" | "caption" | "slides" | "review" | "publish" | "metrics" | "costUsd">> = {}) {
  const sets = ["updated_at = now()"];
  const params: unknown[] = [id];
  if (state) {
    params.push(state);
    sets.push(`state = $${params.length}`);
  }
  for (const [k, v] of Object.entries(patch)) {
    params.push(JSON_FIELDS.has(k) && v != null ? JSON.stringify(v) : v);
    sets.push(`${COLUMN[k] ?? k} = $${params.length}`);
  }
  await sql(`update briefs set ${sets.join(", ")} where id = $1`, params);
  if (state || note) {
    const current = state ?? (await brief(id))?.state;
    await sql("insert into events (brief_id, state, note) values ($1,$2,$3)", [id, current, note]);
  }
}

/** Take a brief for work only if it is still in one of these states, so two runs never work the same brief. */
export async function claim(id: string, from: State[], to: State, note: string) {
  const rows = await sql("update briefs set state = $2, error = null, updated_at = now() where id = $1 and state = any($3) returning id", [id, to, from]);
  if (rows.length) await sql("insert into events (brief_id, state, note) values ($1,$2,$3)", [id, to, note]);
  return rows.length > 0;
}

export type DaySummary = { briefs: number; byState: Record<State, number>; costUsd: number; views: number | null };
export function summarise(list: Brief[]): DaySummary {
  const byState = { planned: 0, generating: 0, reviewing: 0, ready: 0, published: 0, failed: 0 } as Record<State, number>;
  let views: number | null = null;
  for (const b of list) {
    byState[b.state]++;
    if (b.metrics?.views != null) views = (views ?? 0) + b.metrics.views;
  }
  return { briefs: list.length, byState, costUsd: list.reduce((a, b) => a + b.costUsd, 0), views };
}
