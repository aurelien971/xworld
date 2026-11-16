import { liveAccounts } from "./accounts";
import { briefsOn } from "./briefs";
import { sql } from "./db";
import * as registry from "./registry";
import { generationKey } from "./stages/transform";
import { rng, shuffled } from "./time";
import type { Inputs } from "./types";

/**
 * The day's briefs. For every account that is not paused, its persona's
 * formats that fit the platform, filled with pairs nobody has posted yet:
 * approved filter on approved photo, already generated first (free), then up
 * to the product's daily allowance of new ones. Within a day no photo and no
 * filter repeats while there is a choice, and hooks rotate least-used first.
 */
type Pair = { asset: string; filter: string; variation: string; cached: boolean };
const pairId = (p: { asset: string; filter: string; variation: string }) => `${p.asset}|${p.filter}|${p.variation}`;

export async function planDay(productId: string, day: string) {
  const existing = await briefsOn(productId, day);
  if (existing.length) return { created: 0, briefs: existing.length };

  const product = registry.product(productId);
  const filters = registry.filters(productId).filter((f) => f.approved);
  const hooks = registry.angles(productId).hooks.filter((h) => h.validated);
  if (!hooks.length) throw new Error("No validated hooks for this product.");
  const random = rng(`${productId}:${day}`);

  const assets = (await sql<{ id: string }>("select id from assets where product = $1 and kind = 'photo' and approved", [productId])).map((a) => a.id);
  const generated = new Set((await sql<{ key: string }>("select key from generations")).map((g) => g.key));
  // A pair goes out once per format and once per account: the same pair as a carousel and as a video is two posts, not a repeat.
  const used = new Set<string>();
  for (const r of await sql<{ k: string; format: string; account: string }>("select (inputs->>'asset') || '|' || (inputs->>'filter') || '|' || (inputs->>'variation') as k, format, account from briefs where product = $1", [productId])) {
    used.add(`${r.k}#f:${r.format}`);
    used.add(`${r.k}#a:${r.account}`);
  }
  const hookUses = new Map<string, number>();
  for (const r of await sql<{ hook: string; n: number }>("select inputs->>'hook' as hook, count(*)::int as n from briefs where product = $1 group by 1", [productId])) hookUses.set(r.hook, r.n);

  const pool: Pair[] = [];
  for (const asset of assets) for (const f of filters) for (const v of f.variations) {
    pool.push({ asset, filter: f.id, variation: v.id, cached: generated.has(generationKey(asset, f.id, v.id, v.prompt)) });
  }
  const free = shuffled(pool.filter((p) => p.cached), random);
  const fresh = shuffled(pool.filter((p) => !p.cached), random);
  let freshLeft = product.freshPerDay;

  const dayAssets = new Set<string>(), dayFilters = new Set<string>();
  const dayPairs = new Set<string>();
  const take = (from: Pair[], format: string, account: string) => {
    const free = (p: Pair) => !used.has(`${pairId(p)}#f:${format}`) && !used.has(`${pairId(p)}#a:${account}`);
    const score = (p: Pair) => (dayPairs.has(pairId(p)) ? 4 : 0) + (dayAssets.has(p.asset) ? 2 : 0) + (dayFilters.has(p.filter) ? 1 : 0);
    let best = -1;
    for (let i = 0; i < from.length; i++) if (free(from[i]) && (best < 0 || score(from[i]) < score(from[best]))) best = i;
    if (best < 0) return null;
    const p = from[best];
    used.add(`${pairId(p)}#f:${format}`);
    used.add(`${pairId(p)}#a:${account}`);
    dayPairs.add(pairId(p));
    return p;
  };
  const nextHook = (not?: string) => {
    const order = shuffled(hooks, random).sort((a, b) => (hookUses.get(a.id) ?? 0) - (hookUses.get(b.id) ?? 0));
    const h = order.find((x) => x.id !== not) ?? order[0];
    hookUses.set(h.id, (hookUses.get(h.id) ?? 0) + 1);
    return h.id;
  };

  let seq = 0;
  for (const account of (await liveAccounts()).filter((a) => a.status !== "paused" && a.status !== "placeholder")) {
    const persona = registry.persona(account.persona);
    if (persona.product !== productId) continue;
    const formats = registry.formatsFor(persona).filter((f) => f.platforms.includes(account.platform));
    if (!formats.length) continue;
    for (let i = 0; i < account.perDay; i++) {
      const format = formats[(i + seq) % formats.length];
      let pair = take(free, format.id, account.id);
      if (!pair && freshLeft > 0) {
        pair = take(fresh, format.id, account.id);
        if (pair) freshLeft--;
      }
      if (!pair) break;
      dayAssets.add(pair.asset);
      dayFilters.add(pair.filter);
      const hook = nextHook();
      const inputs: Inputs = { asset: pair.asset, filter: pair.filter, variation: pair.variation, hook, captionHook: nextHook(hook), seed: Math.floor(random() * 2 ** 31), time: account.times[i % account.times.length] };
      seq++;
      const id = `${productId}-${day}-${String(seq).padStart(2, "0")}`;
      await sql(
        "insert into briefs (id, day, seq, product, persona, account, format, inputs, state) values ($1,$2,$3,$4,$5,$6,$7,$8,'planned') on conflict (id) do nothing",
        [id, day, seq, productId, persona.id, account.id, format.id, JSON.stringify(inputs)],
      );
      await sql("insert into events (brief_id, state, note) values ($1,'planned',$2)", [id, pair.cached ? "Pair already generated" : "New pair"]);
    }
  }
  return { created: seq, briefs: seq };
}
