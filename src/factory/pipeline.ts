import { liveAccount } from "./accounts";
import { aligned, alignedSet, type Alignment } from "./align";
import { brief as load, briefsOn, claim, update } from "./briefs";
import { sql } from "./db";
import * as registry from "./registry";
import type { ScenePair } from "./scenes";
import { compose } from "./stages/compose";
import { judge, judgeAvailable } from "./stages/judge";
import { publishBlocker, send, standing } from "./stages/publish";
import { generationKey, transform } from "./stages/transform";
import { get } from "./storage";
import { dayOf, TZ } from "./time";
import type { Brief, PairRef } from "./types";

/**
 * One brief through its states: planned → generating (its pairs, then the
 * slides or the video) → reviewing (the judge, or a person when there is no
 * judge or the judge is unsure) → ready → published. Anything that breaks
 * lands on failed with the reason in plain words, and can be run again.
 */
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 400);
const waiting = (note: string) => ({ by: "none" as const, outcome: "hold" as const, note, at: new Date().toISOString() });

/** "Film · '70s Vintage", but only the filter's name when the variation's label just repeats it. */
const filterLabel = (name: string, label: string) => {
  const words = new Set(name.toLowerCase().split(/\s+/));
  return label.toLowerCase().split(/\s+/).some((w) => words.has(w)) ? name : `${name} · ${label}`;
};

/** A brief's pairs: its main one, then any more a multi-pair format asked for. */
export const pairsOf = (b: Brief): PairRef[] => [{ asset: b.inputs.asset, filter: b.inputs.filter, variation: b.inputs.variation }, ...(b.inputs.more ?? [])];

/** The words on the post: the idea's own when the brief came from one, else a validated hook. */
function wordsOf(b: Brief) {
  const angles = registry.angles(b.product);
  const filter = registry.filter(b.product, b.inputs.filter);
  const hook = b.inputs.hookText ?? angles.hooks.find((h) => h.id === b.inputs.hook)?.text ?? "";
  const caption = b.inputs.captionText ?? angles.captionLine.replace("{hook}", angles.hooks.find((h) => h.id === b.inputs.captionHook)?.text ?? "").replace("{filter}", filter.name).trim();
  return { hook, caption, text: b.inputs.text ?? "" };
}

type Built = { pairs: ScenePair[]; alignment: Alignment; cost: number; fresh: number; judgeable: { key: string; before: Buffer; after: Buffer; filterName: string; benefit: string } };

/**
 * A brief's pairs, generated (or taken from what is kept) and registered.
 * Several filters on one photo are registered together, so every frame of
 * that photo lies over every other; different photos are registered each on
 * their own.
 */
async function build(b: Brief, generate: boolean): Promise<Built> {
  const refs = pairsOf(b);
  let cost = 0, fresh = 0;
  const loaded: { ref: PairRef; key: string; filter: ReturnType<typeof registry.filter>; label: string; before: Buffer; after: Buffer }[] = [];
  for (const ref of refs) {
    const filter = registry.filter(b.product, ref.filter);
    const variation = filter.variations.find((v) => v.id === ref.variation);
    if (!variation) throw new Error(`The filter "${filter.name}" has no variation "${ref.variation}".`);
    const [asset] = await sql<{ media_key: string }>("select media_key from assets where id = $1", [ref.asset]);
    if (!asset) throw new Error("A source photo is no longer in the library.");
    const key = generationKey(ref.asset, filter.id, variation.id, variation.prompt);
    let mediaKey: string;
    if (generate) {
      const g = await transform({ asset: ref.asset, assetKey: asset.media_key, filter: filter.id, variation: variation.id, prompt: variation.prompt, quality: filter.quality });
      if (!g.cached) {
        cost += g.costUsd ?? 0;
        fresh++;
      }
      mediaKey = g.mediaKey;
    } else {
      const [gen] = await sql<{ media_key: string }>("select media_key from generations where key = $1", [key]);
      if (!gen) throw new Error("A pair of this brief was never generated.");
      mediaKey = gen.media_key;
    }
    loaded.push({ ref, key, filter, label: filterLabel(filter.name, variation.label), before: await get(asset.media_key), after: await get(mediaKey) });
  }

  const sameAsset = loaded.length > 1 && loaded.every((l) => l.ref.asset === loaded[0].ref.asset);
  const pairs: ScenePair[] = [];
  let alignment: Alignment;
  if (sameAsset) {
    const set = await alignedSet(loaded[0].before, loaded.map((l) => l.after));
    for (const [i, l] of loaded.entries()) pairs.push({ before: set.before, after: set.afters[i], filterLabel: l.label });
    alignment = set.alignments[0];
  } else {
    const each: Alignment[] = [];
    for (const l of loaded) {
      const one = await aligned(l.before, l.after);
      pairs.push({ before: one.before, after: one.after, filterLabel: l.label });
      each.push(one.alignment);
    }
    alignment = each[0];
  }
  await sql("insert into alignments (key, result) values ($1,$2) on conflict (key) do update set result = excluded.result", [loaded[0].key, JSON.stringify(alignment)]);
  return { pairs, alignment, cost, fresh, judgeable: { key: loaded[0].key, before: pairs[0].before, after: pairs[0].after, filterName: loaded[0].filter.name, benefit: loaded[0].filter.benefit } };
}

export async function runBrief(id: string) {
  if (!(await claim(id, ["planned", "failed"], "generating", "Started"))) return;
  let cost = 0;
  try {
    const b = (await load(id))!;
    const built = await build(b, true);
    cost = built.cost;
    const n = built.pairs.length;
    await update(id, null, built.fresh ? `Generated ${built.fresh} of ${n} for $${built.cost.toFixed(3)}` : n > 1 ? `Used ${n} kept generations` : "Used the kept generation", { costUsd: cost });
    if (built.alignment.applied) await update(id, null, `After laid over the before: ${Math.round(Math.abs(built.alignment.scale - 1) * 100)}% zoom corrected`);

    const words = wordsOf(b);
    const { slides, video } = await compose({ briefId: id, format: registry.format(b.format), product: registry.product(b.product), pairs: built.pairs, hook: words.hook, text: words.text });
    await update(id, "reviewing", video ? `Video made, ${video.seconds}s` : `${slides.length} ${slides.length === 1 ? "picture" : "slides"} made`, { slides, video, align: built.alignment, caption: words.caption });

    if (!judgeAvailable()) {
      await update(id, null, "Waiting for a person: no review model is set", { review: waiting("No review model is set.") });
      return;
    }
    // A review model that cannot answer is not a reason to throw the slides away: the brief waits for a person instead.
    const verdict = await judge(built.judgeable).catch(async (e) => {
      await update(id, null, "Waiting for a person: the review model did not answer", { review: waiting(`The review model did not answer: ${message(e)}`) });
      return null;
    });
    if (!verdict) return;
    cost += verdict.costUsd;
    const { costUsd: _c, cached: _k, ...review } = verdict;
    void _c; void _k;
    if (review.outcome === "pass") {
      await update(id, "ready", `Passed review at ${review.score}`, { review, costUsd: cost });
      await dispatch(id);
    } else if (review.outcome === "hold") {
      await update(id, null, `Held for a person at ${review.score}`, { review, costUsd: cost });
    } else {
      await update(id, "failed", `Rejected in review at ${review.score}`, { review, costUsd: cost, error: review.note || "Rejected in review" });
    }
  } catch (e) {
    await update(id, "failed", message(e), { error: message(e), costUsd: cost });
  }
}

/** Make a brief's slides or video again from the same pairs and words, at no cost: for when a scene or a format changes. Its state stays as it is. */
export async function remake(id: string) {
  const b = await load(id);
  if (!b || !b.slides.length) return false;
  const built = await build(b, false);
  const words = wordsOf(b);
  const { slides, video } = await compose({ briefId: id, format: registry.format(b.format), product: registry.product(b.product), pairs: built.pairs, hook: words.hook, text: words.text });
  await update(id, null, "Made again", { slides, video, align: built.alignment });
  return true;
}

/** Every brief that is not out yet, made again. */
export async function remakeAll(product: string) {
  const ids = await sql<{ id: string }>("select id from briefs where product = $1 and state <> 'published' and jsonb_array_length(slides) > 0 and publish is null", [product]);
  let n = 0;
  for (const { id } of ids) if (await remake(id).catch(() => false)) n++;
  return n;
}

/** A person's call on a brief that is waiting in review (or a second look at a rejected one). */
export async function reviewBrief(id: string, pass: boolean) {
  const b = await load(id);
  if (!b || !b.slides.length || !["reviewing", "failed", "ready"].includes(b.state) || b.publish) return false;
  // The judge's scores stay beside a person's call; a note that only said "waiting" does not.
  const kept = b.review && b.review.by !== "none" ? { score: b.review.score, realism: b.review.realism, alignment: b.review.alignment, appeal: b.review.appeal, note: b.review.note, model: b.review.model } : {};
  const review = { ...kept, by: "person" as const, outcome: pass ? ("pass" as const) : ("reject" as const), at: new Date().toISOString() };
  if (pass) {
    await update(id, "ready", "Approved by a person", { review, error: null });
    await dispatch(id);
  } else {
    await update(id, "failed", "Rejected by a person", { review, error: "Rejected by a person" });
  }
  return true;
}

/** Whether a brief's time has come: its own day, at or after its hour. Older days are never caught up, so connecting an account does not flood it. */
const due = (b: Brief) => b.day === dayOf() && b.inputs.time <= new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

/** Post a ready brief, when its time has come and its account takes posts. Otherwise it waits as ready, and the screen says why. */
export async function dispatch(id: string) {
  const b = await load(id);
  if (!b || b.state !== "ready" || b.publish?.ref || !due(b)) return;
  const account = await liveAccount(b.account);
  if (!account || publishBlocker(account)) return;
  // Three tries, then it waits for a person.
  const tries = (b.publish?.status === "failed" ? (b.publish as { tries?: number }).tries ?? 1 : 0) + 1;
  if (tries > 3) return;
  try {
    const publish = await send(b, account, registry.product(b.product).hashtags);
    const live = publish.status === "live";
    await update(id, live ? "published" : null, live ? `Posted to ${account.platform} as @${account.handle}` : `Sent to ${account.platform}, still being processed`, { publish });
  } catch (e) {
    await update(id, null, `Not posted: ${message(e)}`, { publish: { status: "failed", error: message(e), at: new Date().toISOString(), tries } as Brief["publish"] });
  }
}

/** Everything that is ready and due today, posted; and what a platform was still processing, finished off. */
export async function publishDue(product: string) {
  for (const b of await briefsOn(product, dayOf())) {
    if (b.state === "ready" && !b.publish?.ref) await dispatch(b.id);
    else if (b.publish?.status === "sent") await settle(b);
  }
}

async function settle(b: Brief) {
  const account = await liveAccount(b.account);
  const s = account ? await standing(b, account).catch(() => null) : null;
  if (!s || !b.publish) return;
  const publish = { ...b.publish, status: s.status, ref: s.ref ?? b.publish.ref, url: s.url ?? b.publish.url, error: s.error };
  const metrics = s.metrics ? { ...s.metrics, at: new Date().toISOString() } : b.metrics;
  const becameLive = s.status === "live" && b.state !== "published";
  await update(b.id, becameLive ? "published" : null, becameLive ? "Live" : null, { publish, metrics });
}

/** The numbers of everything posted in the last two weeks, read again. */
export async function measure(product: string) {
  const ids = await sql<{ id: string }>("select id from briefs where product = $1 and publish->>'ref' is not null and day > current_date - 14", [product]);
  for (const { id } of ids) {
    const b = await load(id);
    if (b) await settle(b);
  }
}

const g = globalThis as unknown as { __factoryRuns?: Map<string, Promise<void>> };
const runs = (g.__factoryRuns ??= new Map());

/** Every planned brief of a day, two at a time. One run per day at once; a second call joins the first. */
export function runDay(product: string, day: string, ids?: string[]) {
  const key = `${product}:${day}`;
  const running = runs.get(key);
  if (running && !ids) return running;
  const job = (async () => {
    const list = (await briefsOn(product, day)).filter((b) => (ids ? ids.includes(b.id) : b.state === "planned")).map((b) => b.id);
    const workers = Array.from({ length: Math.min(2, list.length) }, async () => {
      for (let id = list.shift(); id; id = list.shift()) await runBrief(id);
    });
    await Promise.all(workers);
  })().finally(() => {
    if (runs.get(key) === job) runs.delete(key);
  });
  if (!ids) runs.set(key, job);
  return job;
}
