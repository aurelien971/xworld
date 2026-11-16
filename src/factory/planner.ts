import { liveAccounts } from "./accounts";
import { briefsOn } from "./briefs";
import { sql } from "./db";
import * as registry from "./registry";
import { generationKey } from "./stages/transform";
import { rng, shuffled } from "./time";
import type { Format, Idea, Inputs, PairRef } from "./types";

/**
 * The day's briefs. Every account slot gets its posts: a connected or
 * warming account its full day, a slot with no account yet a small
 * stockpile, so its feed is ready the day it is connected.
 *
 * A post starts from an approved idea of the slot's persona when there is
 * one (its format, its words, the filter it asks for); otherwise from a
 * validated hook and the next format in turn. It is then filled with pairs:
 * approved filter on approved photo, already generated first (free), then
 * up to the product's daily allowance of new ones. A pair goes out once per
 * format and once per account, so the same pair as a carousel and as a
 * video is two posts, not a repeat. Within a day no photo and no filter
 * repeats while there is a choice.
 */
type Pair = PairRef & { cached: boolean };
const pairId = (p: PairRef) => `${p.asset}|${p.filter}|${p.variation}`;

export const ideaStates = async () => new Map((await sql<{ id: string; state: string }>("select id, state from idea_state")).map((r) => [r.id, r.state]));

export async function planDay(productId: string, day: string) {
  const existing = await briefsOn(productId, day);
  if (existing.length) return { created: 0, briefs: existing.length };

  const product = registry.product(productId);
  const overrides = new Map((await sql<{ id: string; approved: boolean }>("select id, approved from filter_state")).map((r) => [r.id, r.approved]));
  const filters = registry.filters(productId).filter((f) => overrides.get(f.id) ?? f.approved);
  const hooks = registry.angles(productId).hooks.filter((h) => h.validated);
  if (!hooks.length) throw new Error("No validated hooks for this product.");
  const random = rng(`${productId}:${day}`);

  const assets = (await sql<{ id: string }>("select id from assets where product = $1 and kind = 'photo' and approved", [productId])).map((a) => a.id);
  const generated = new Set((await sql<{ key: string }>("select key from generations")).map((g) => g.key));

  const used = new Set<string>();
  const usedIdeas = new Set<string>();
  for (const r of await sql<{ inputs: Inputs; format: string; account: string }>("select inputs, format, account from briefs where product = $1", [productId])) {
    for (const p of [r.inputs, ...(r.inputs.more ?? [])]) {
      used.add(`${pairId(p)}#f:${r.format}`);
      used.add(`${pairId(p)}#a:${r.account}`);
    }
    if (r.inputs.idea) usedIdeas.add(r.inputs.idea);
  }
  const hookUses = new Map<string, number>();
  for (const r of await sql<{ hook: string; n: number }>("select inputs->>'hook' as hook, count(*)::int as n from briefs where product = $1 group by 1", [productId])) hookUses.set(r.hook, r.n);

  const pool: Pair[] = [];
  const isWeak = registry.weak(productId);
  for (const asset of assets) for (const f of filters) for (const v of f.variations) {
    if (isWeak(f.id, v.id)) continue;
    pool.push({ asset, filter: f.id, variation: v.id, cached: generated.has(generationKey(asset, f.id, v.id, v.prompt)) });
  }
  const order = shuffled(pool, random);
  let freshLeft = product.freshPerDay;

  const states = await ideaStates();
  const ideasFor = new Map<string, Idea[]>();
  for (const idea of shuffled(registry.ideas(productId), random)) {
    if (states.get(idea.id) !== "approved" || usedIdeas.has(idea.id)) continue;
    ideasFor.set(idea.persona, [...(ideasFor.get(idea.persona) ?? []), idea]);
  }

  const dayAssets = new Set<string>(), dayFilters = new Set<string>(), dayPairs = new Set<string>();
  const free = (p: Pair, format: string, account: string) => (p.cached || freshLeft > 0) && !used.has(`${pairId(p)}#f:${format}`) && !used.has(`${pairId(p)}#a:${account}`);
  const score = (p: Pair, want: string) => (p.cached ? 0 : 8) + (dayPairs.has(pairId(p)) ? 4 : 0) + (dayAssets.has(p.asset) ? 2 : 0) + (dayFilters.has(p.filter) ? 1 : 0) - (want && p.filter === want ? 16 : 0);
  const claim = (set: Pair[], format: string, account: string) => {
    for (const p of set) {
      used.add(`${pairId(p)}#f:${format}`);
      used.add(`${pairId(p)}#a:${account}`);
      dayPairs.add(pairId(p));
      dayAssets.add(p.asset);
      dayFilters.add(p.filter);
      if (!p.cached) freshLeft--;
    }
    return set;
  };

  /** The pairs a format needs, or null when the library cannot fill it. */
  function pick(format: Format, account: string, want: string): Pair[] | null {
    const candidates = order.filter((p) => free(p, format.id, account)).sort((a, b) => score(a, want) - score(b, want));
    // An idea that names a filter waits for that filter: any other would not match its words.
    if (want && !candidates.some((p) => p.filter === want)) return null;
    if (!format.needs) return candidates.length ? claim([candidates[0]], format.id, account) : null;
    const { count, mode } = format.needs;
    const groups = new Map<string, Pair[]>();
    for (const p of candidates) {
      const key = mode === "same-asset" ? p.asset : p.filter;
      const group = groups.get(key) ?? [];
      // Within a group, one of each: a photo's filters must differ, a filter's photos must differ.
      if (!group.some((q) => (mode === "same-asset" ? q.filter === p.filter : q.asset === p.asset))) group.push(p);
      groups.set(key, group);
    }
    const full = [...groups.values()].filter((g) => g.length >= count && (!want || g.slice(0, count).some((p) => p.filter === want)));
    if (!full.length) return null;
    const best = full.sort((a, b) => a.slice(0, count).reduce((n, p) => n + score(p, want), 0) - b.slice(0, count).reduce((n, p) => n + score(p, want), 0))[0];
    return claim(best.slice(0, count), format.id, account);
  }

  const nextHook = (not?: string) => {
    const sorted = shuffled(hooks, random).sort((a, b) => (hookUses.get(a.id) ?? 0) - (hookUses.get(b.id) ?? 0));
    const h = sorted.find((x) => x.id !== not) ?? sorted[0];
    hookUses.set(h.id, (hookUses.get(h.id) ?? 0) + 1);
    return h.id;
  };

  let seq = 0;
  for (const account of (await liveAccounts()).filter((a) => a.status !== "paused")) {
    const persona = registry.persona(account.persona);
    if (persona.product !== productId) continue;
    const formats = registry.formatsFor(persona).filter((f) => f.platforms.includes(account.platform));
    if (!formats.length) continue;
    const posts = account.status === "placeholder" ? (product.campaign?.stockpilePerDay ?? 1) : account.perDay;
    for (let i = 0; i < posts; i++) {
      // An approved idea first; when the library cannot fill its format, the next one.
      let idea: Idea | undefined, format: Format | undefined, pairs: Pair[] | null = null;
      const mine = ideasFor.get(persona.id) ?? [];
      for (const candidate of mine.slice(0, 6)) {
        const f = formats.find((x) => x.id === candidate.format);
        const got = f ? pick(f, account.id, candidate.filter) : null;
        if (f && got) {
          idea = candidate;
          format = f;
          pairs = got;
          mine.splice(mine.indexOf(candidate), 1);
          break;
        }
      }
      // No idea to use: a validated hook, and the formats in turn until one can be filled.
      for (let k = 0; !pairs && k < formats.length; k++) {
        const f = formats[(i + seq + k) % formats.length];
        // These formats' words come from an idea; without one they have nothing to say.
        if (["tip-card", "dm-reveal", "ranked", "the-verdict"].includes(f.id)) continue;
        pairs = pick(f, account.id, "");
        if (pairs) format = f;
      }
      if (!pairs || !format) break;

      const [main, ...more] = pairs.map(({ asset, filter, variation }) => ({ asset, filter, variation }));
      const hook = nextHook();
      const inputs: Inputs = {
        ...main, ...(more.length ? { more } : {}),
        ...(idea ? { idea: idea.id, hookText: idea.hook, captionText: idea.caption, text: idea.text } : {}),
        hook, captionHook: nextHook(hook), seed: Math.floor(random() * 2 ** 31), time: account.times[i % account.times.length],
      };
      seq++;
      const id = `${productId}-${day}-${String(seq).padStart(2, "0")}`;
      await sql(
        "insert into briefs (id, day, seq, product, persona, account, format, inputs, state) values ($1,$2,$3,$4,$5,$6,$7,$8,'planned') on conflict (id) do nothing",
        [id, day, seq, productId, persona.id, account.id, format.id, JSON.stringify(inputs)],
      );
      const fresh = pairs.filter((p) => !p.cached).length;
      await sql("insert into events (brief_id, state, note) values ($1,'planned',$2)", [id, `${idea ? "From an idea" : "From a validated hook"}, ${fresh ? `${fresh} new ${fresh === 1 ? "pair" : "pairs"}` : pairs.length > 1 ? `${pairs.length} pairs already generated` : "pair already generated"}`]);
    }
  }
  return { created: seq, briefs: seq };
}
