import { liveAccounts, type LiveAccount } from "./accounts";
import { allBriefs, brief as load, briefsOn, eventsOf, summarise, type DaySummary } from "./briefs";
import { sql } from "./db";
import * as registry from "./registry";
import { publishBlocker } from "./stages/publish";
import { generationKey } from "./stages/transform";
import { mediaUrl } from "./storage";
import { dayOf } from "./time";
import { tuningOf, type Tuning } from "./tuning";
import type { Brief, BriefEvent } from "./types";

/**
 * What the screen reads: a day's briefs with every id already resolved to
 * the words a person would use, and one brief in full. The screen never
 * reads a registry or a table itself.
 */
export type BriefView = Omit<Brief, "slides" | "video"> & {
  /** A video post's file, ready to play. */
  video: { url: string; seconds: number; width: number; height: number } | null;
  slides: { scene: string; url: string; thumb: string; width: number; height: number }[];
  hook: string;
  filterName: string;
  variationLabel: string;
  formatName: string;
  personaName: string;
  handle: string;
  platform: string;
  /** In review and waiting for a person, as opposed to being looked at right now. */
  needsPerson: boolean;
  /** Turned down in review, by the judge or a person: a decision, not a fault. */
  rejected: boolean;
  /** The source photo, shown until the slides exist. */
  before: string | null;
  /** Why a ready brief has not been handed to the publisher, in plain words. */
  blocker: string | null;
};

export type DayView = { product: { id: string; name: string }; day: string; today: string; briefs: BriefView[]; summary: DaySummary; plannable: number };

export type BriefDetail = BriefView & {
  events: BriefEvent[];
  /** The format's dials as they stand for this post. Null once it is out, or before it is made. */
  tuning: Tuning | null;
  source: { before: string; after: string | null; tags: string[]; gender: string | null; prompt: string; quality: string; generation: { source: string; costUsd: number | null; createdAt: string } | null };
};

function view(b: Brief, before: string | null, accounts: LiveAccount[]): BriefView {
  const filters = registry.filters(b.product);
  const filter = filters.find((f) => f.id === b.inputs.filter);
  const variation = filter?.variations.find((v) => v.id === b.inputs.variation);
  const account = accounts.find((a) => a.id === b.account);
  const hook = registry.angles(b.product).hooks.find((h) => h.id === b.inputs.hook)?.text ?? "";
  return {
    ...b,
    video: b.video ? { url: mediaUrl(b.video.key), seconds: b.video.seconds, width: b.video.width, height: b.video.height } : null,
    slides: b.slides.map((s) => ({ scene: s.scene, url: mediaUrl(s.key), thumb: mediaUrl(s.thumb), width: s.width, height: s.height })),
    hook,
    filterName: filter?.name ?? b.inputs.filter,
    variationLabel: variation?.label ?? b.inputs.variation,
    formatName: registry.formats().find((f) => f.id === b.format)?.name ?? b.format,
    personaName: registry.personas().find((p) => p.id === b.persona)?.name ?? b.persona,
    handle: account?.handle ?? b.account,
    platform: account?.platform ?? "",
    needsPerson: b.state === "reviewing" && b.review?.outcome === "hold",
    rejected: b.state === "failed" && b.review?.outcome === "reject",
    before,
    blocker: b.state === "ready" && !b.publish?.ref && account ? publishBlocker(account) : null,
  };
}

export async function dayView(productId: string, day: string): Promise<DayView> {
  const product = registry.product(productId);
  const list = await briefsOn(productId, day);
  const accounts = await liveAccounts();
  const plannable = accounts.filter((a) => a.status !== "paused" && a.status !== "placeholder" && registry.personas().some((p) => p.id === a.persona && p.product === productId)).reduce((n, a) => n + a.perDay, 0);
  const photos = new Map((await sql<{ id: string; media_key: string }>("select id, media_key from assets where id = any($1)", [list.map((b) => b.inputs.asset)])).map((a) => [a.id, mediaUrl(a.media_key)]));
  return { product: { id: product.id, name: product.name }, day, today: dayOf(), briefs: list.map((b) => view(b, photos.get(b.inputs.asset) ?? null, accounts)), summary: summarise(list), plannable };
}

/** Everything a product has made, with the counts that matter: how many are ready to go and how many are out. */
export type WallView = { product: { id: string; name: string }; briefs: BriefView[]; counts: { made: number; ready: number; posted: number; review: number } };

export async function wallView(productId: string, limit = 600): Promise<WallView> {
  const product = registry.product(productId);
  const list = await allBriefs(productId, limit);
  const photos = new Map((await sql<{ id: string; media_key: string }>("select id, media_key from assets where id = any($1)", [list.map((b) => b.inputs.asset)])).map((a) => [a.id, mediaUrl(a.media_key)]));
  const accounts = await liveAccounts();
  const briefs = list.map((b) => view(b, photos.get(b.inputs.asset) ?? null, accounts));
  const [n] = await sql<{ made: number; ready: number; posted: number; review: number }>(
    "select count(*) filter (where jsonb_array_length(slides) > 0)::int as made, count(*) filter (where state = 'ready')::int as ready, count(*) filter (where state = 'published')::int as posted, count(*) filter (where state = 'reviewing')::int as review from briefs where product = $1",
    [productId],
  );
  return { product: { id: product.id, name: product.name }, briefs, counts: n };
}

export async function briefDetail(id: string): Promise<BriefDetail | null> {
  const b = await load(id);
  if (!b) return null;
  const filter = registry.filters(b.product).find((f) => f.id === b.inputs.filter);
  const variation = filter?.variations.find((x) => x.id === b.inputs.variation);
  const [asset] = await sql<{ media_key: string; tags: string[]; meta: { gender?: string | null } }>("select media_key, tags, meta from assets where id = $1", [b.inputs.asset]);
  const [gen] = variation
    ? await sql<{ media_key: string; source: string; cost_usd: string | null; created_at: Date }>("select media_key, source, cost_usd, created_at from generations where key = $1", [generationKey(b.inputs.asset, b.inputs.filter, b.inputs.variation, variation.prompt)])
    : [];
  return {
    ...view(b, asset ? mediaUrl(asset.media_key) : null, await liveAccounts()),
    events: await eventsOf(id),
    tuning: b.slides.length && !b.publish && b.state !== "published" ? await tuningOf(b.format, b.id) : null,
    source: {
      before: asset ? mediaUrl(asset.media_key) : "",
      after: gen ? mediaUrl(gen.media_key) : null,
      tags: asset?.tags ?? [],
      gender: asset?.meta?.gender ?? null,
      prompt: variation?.prompt ?? "",
      quality: filter?.quality ?? "",
      generation: gen ? { source: gen.source, costUsd: gen.cost_usd == null ? null : Number(gen.cost_usd), createdAt: new Date(gen.created_at).toISOString() } : null,
    },
  };
}
