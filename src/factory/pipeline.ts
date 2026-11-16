import { liveAccount } from "./accounts";
import { aligned, type Alignment } from "./align";
import { brief as load, briefsOn, claim, update } from "./briefs";
import { sql } from "./db";
import * as registry from "./registry";
import { compose } from "./stages/compose";
import { judge, judgeAvailable } from "./stages/judge";
import { publishBlocker, send, standing } from "./stages/publish";
import { generationKey, transform } from "./stages/transform";
import { get } from "./storage";
import type { Brief } from "./types";

/**
 * One brief through its states: planned → generating (the pair, then the
 * slides) → reviewing (the judge, or a person when there is no judge or the
 * judge is unsure) → ready → published. Anything that breaks lands on failed
 * with the reason in plain words, and can be run again from there.
 */
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 400);

function captionFor(b: Brief) {
  const angles = registry.angles(b.product);
  const filter = registry.filter(b.product, b.inputs.filter);
  const hook = angles.hooks.find((h) => h.id === b.inputs.captionHook)?.text ?? "";
  return angles.captionLine.replace("{hook}", hook).replace("{filter}", filter.name).trim();
}

/** The pair, registered: the after laid over the before and both cut to what they share. Worked out once per pair and kept. */
async function registered(key: string, before: Buffer, after: Buffer) {
  const out = await aligned(before, after);
  await sql("insert into alignments (key, result) values ($1,$2) on conflict (key) do update set result = excluded.result", [key, JSON.stringify(out.alignment)]);
  return out as { before: Buffer; after: Buffer; alignment: Alignment };
}

const waiting = (note: string) => ({ by: "none" as const, outcome: "hold" as const, note, at: new Date().toISOString() });

/** "Film · '70s Vintage", but only the filter's name when the variation's label just repeats it. */
const filterLabel = (name: string, label: string) => {
  const words = new Set(name.toLowerCase().split(/\s+/));
  return label.toLowerCase().split(/\s+/).some((w) => words.has(w)) ? name : `${name} · ${label}`;
};

export async function runBrief(id: string) {
  if (!(await claim(id, ["planned", "failed"], "generating", "Started"))) return;
  let cost = 0;
  try {
    const b = (await load(id))!;
    const filter = registry.filter(b.product, b.inputs.filter);
    const variation = filter.variations.find((v) => v.id === b.inputs.variation);
    if (!variation) throw new Error(`The filter "${filter.name}" has no variation "${b.inputs.variation}".`);
    const [asset] = await sql<{ media_key: string }>("select media_key from assets where id = $1", [b.inputs.asset]);
    if (!asset) throw new Error("The source photo is no longer in the library.");

    const generation = await transform({ asset: b.inputs.asset, assetKey: asset.media_key, filter: filter.id, variation: variation.id, prompt: variation.prompt, quality: filter.quality });
    if (!generation.cached) cost += generation.costUsd ?? 0;
    await update(id, null, generation.cached ? "Used the kept generation" : `Generated${generation.costUsd ? ` for $${generation.costUsd.toFixed(3)}` : ""}`, { costUsd: cost });

    const pair = await registered(generation.key, await get(asset.media_key), await get(generation.mediaKey));
    const { before, after } = pair;
    if (pair.alignment.applied) await update(id, null, `After laid over the before: ${Math.round(Math.abs(pair.alignment.scale - 1) * 100)}% zoom corrected`);
    const hook = registry.angles(b.product).hooks.find((h) => h.id === b.inputs.hook)?.text ?? "";
    const format = registry.format(b.format);
    const { slides, video } = await compose({ briefId: id, format, product: registry.product(b.product), before, after, hook, filterLabel: filterLabel(filter.name, variation.label) });
    await update(id, "reviewing", video ? `Video made, ${video.seconds}s` : `${slides.length} slides made`, { slides, video, align: pair.alignment, caption: captionFor(b) });

    if (!judgeAvailable()) {
      await update(id, null, "Waiting for a person: no review model is set", { review: waiting("No review model is set.") });
      return;
    }
    // A review model that cannot answer is not a reason to throw the slides away: the brief waits for a person instead.
    const verdict = await judge({ key: generationKey(b.inputs.asset, filter.id, variation.id, variation.prompt), before, after, filterName: filter.name, benefit: filter.benefit }).catch(async (e) => {
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

/** Make a brief's slides again from the same pair and words, at no cost: for when a scene or a format changes. Its state stays as it is. */
export async function remake(id: string) {
  const b = await load(id);
  if (!b || !b.slides.length) return false;
  const filter = registry.filter(b.product, b.inputs.filter);
  const variation = filter.variations.find((v) => v.id === b.inputs.variation);
  const [asset] = await sql<{ media_key: string }>("select media_key from assets where id = $1", [b.inputs.asset]);
  const [gen] = variation ? await sql<{ media_key: string }>("select media_key from generations where key = $1", [generationKey(b.inputs.asset, filter.id, variation.id, variation.prompt)]) : [];
  if (!variation || !asset || !gen) return false;
  const pair = await registered(generationKey(b.inputs.asset, filter.id, variation.id, variation.prompt), await get(asset.media_key), await get(gen.media_key));
  const hook = registry.angles(b.product).hooks.find((h) => h.id === b.inputs.hook)?.text ?? "";
  const { slides, video } = await compose({ briefId: id, format: registry.format(b.format), product: registry.product(b.product), before: pair.before, after: pair.after, hook, filterLabel: filterLabel(filter.name, variation.label) });
  await update(id, null, "Made again", { slides, video, align: pair.alignment });
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

/** Hand a ready brief to the publisher, when its account can take it. Otherwise it waits as ready, and says why. */
export async function dispatch(id: string) {
  const b = await load(id);
  if (!b || b.state !== "ready" || b.publish?.ref) return;
  const account = await liveAccount(b.account);
  if (!account || publishBlocker(account)) return;
  try {
    const publish = await send(b, account, registry.product(b.product).hashtags);
    await update(id, null, `Sent to the publisher, due ${b.inputs.time}`, { publish });
  } catch (e) {
    await update(id, null, `Not sent: ${message(e)}`, { publish: { status: "failed", error: message(e), at: new Date().toISOString() } });
  }
}

/** Ask the publisher where every sent post stands, and keep its numbers. */
export async function measure(product: string, day: string) {
  for (const b of await briefsOn(product, day)) {
    if (!b.publish?.ref) continue;
    const account = await liveAccount(b.account);
    const s = account ? await standing(b, account).catch(() => null) : null;
    if (!s) continue;
    const publish = { ...b.publish, status: s.status, url: s.url ?? b.publish.url, error: s.error };
    const metrics = s.metrics ? { ...s.metrics, at: new Date().toISOString() } : b.metrics;
    const becameLive = s.status === "live" && b.state !== "published";
    await update(b.id, becameLive ? "published" : null, becameLive ? "Live" : null, { publish, metrics });
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
