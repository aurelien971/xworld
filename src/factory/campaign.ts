import { liveAccounts } from "./accounts";
import { sql } from "./db";
import { ideaStates } from "./planner";
import * as registry from "./registry";
import { judgeAvailable, overall } from "./stages/judge";

/**
 * Where the campaign stands, as a few measures against their targets, and
 * what would move it most right now. Everything here is counted, nothing
 * is estimated.
 */
export type Measure = { id: string; label: string; value: number; target: number; note: string };
export type Step = { title: string; detail: string; view?: string };
export type CampaignView = { product: { id: string; name: string }; measures: Measure[]; next: Step[]; totals: { made: number; ready: number; review: number; posted: number; views: number | null; spent: number; generations: number; ads: number } };

export const filterOverrides = async () => new Map((await sql<{ id: string; approved: boolean }>("select id, approved from filter_state")).map((r) => [r.id, r.approved]));

export async function campaignView(productId: string): Promise<CampaignView> {
  const product = registry.product(productId);
  const goal = product.campaign ?? { posts: 1000, ideas: 300, photos: 100, filters: 30, accounts: 36, stockpilePerDay: 1 };
  const accounts = (await liveAccounts()).filter((a) => registry.personas().some((p) => p.id === a.persona && p.product === productId));
  const connected = accounts.filter((a) => a.connected).length;

  const [b] = await sql<{ made: number; ready: number; review: number; posted: number; views: number | null; spent: number }>(
    "select count(*) filter (where jsonb_array_length(slides) > 0)::int as made, count(*) filter (where state = 'ready')::int as ready, count(*) filter (where state = 'reviewing')::int as review, count(*) filter (where state = 'published')::int as posted, sum((metrics->>'views')::numeric)::float as views, coalesce(sum(cost_usd),0)::float as spent from briefs where product = $1",
    [productId],
  );
  const [a] = await sql<{ approved: number; waiting: number; ads: number }>(
    "select count(*) filter (where kind = 'photo' and approved)::int as approved, count(*) filter (where kind = 'photo' and not approved)::int as waiting, count(*) filter (where kind = 'ad')::int as ads from assets where product = $1",
    [productId],
  );
  const generated = await sql<{ filter_id: string; variation_id: string; n: number }>("select filter_id, variation_id, count(*)::int as n from generations group by 1, 2");
  const generations = generated.reduce((n, g) => n + g.n, 0);

  // A filter is proven when it has been generated at least once and was not seen to be weak.
  const isWeak = registry.weak(productId);
  const filters = registry.filters(productId);
  const proven = filters.filter((f) => f.variations.some((v) => !isWeak(f.id, v.id) && generated.some((g) => g.filter_id === f.id && g.variation_id === v.id))).length;
  const untested = filters.filter((f) => f.origin === "lab" && !generated.some((g) => g.filter_id === f.id)).length;

  const states = await ideaStates();
  const ideas = registry.ideas(productId);
  const approved = ideas.filter((i) => states.get(i.id) === "approved").length;
  const drafts = ideas.filter((i) => !states.has(i.id) || states.get(i.id) === "draft").length;
  const blocked = ideas.filter((i) => i.filter && !generated.some((g) => g.filter_id === i.filter)).length;

  const measures: Measure[] = [
    { id: "posted", label: "Posts out", value: b.posted, target: goal.posts, note: `${b.ready} ready to go, ${b.review} waiting for review` },
    { id: "made", label: "Posts made", value: b.made, target: goal.posts, note: `${generations} filter results in the bank` },
    { id: "ideas", label: "Ideas approved", value: approved, target: goal.ideas, note: `${ideas.length} written, ${drafts} to read${blocked ? `, ${blocked} need a filter that has not been generated` : ""}` },
    { id: "accounts", label: "Accounts connected", value: connected, target: accounts.length, note: `${registry.personas().filter((p) => p.product === productId).length} personas, four platforms each` },
    { id: "photos", label: "Source photos approved", value: a.approved, target: goal.photos, note: `${a.waiting} waiting for a look` },
    { id: "filters", label: "Filters proven", value: proven, target: goal.filters, note: `${untested} new ones written and never generated` },
  ];

  // What would move the campaign most, in order. Each is true right now, or it is not listed.
  const next: Step[] = [];
  if (!judgeAvailable()) next.push({ title: "Give the factory an image key with credit", detail: `Nothing new can be generated or judged without one. ${untested} new filters and ${blocked} ideas are waiting on it.`, view: "filters" });
  if (connected === 0) next.push({ title: "Connect the first account", detail: `${accounts.filter((x) => x.offered).length} of ${accounts.length} slots can be connected now. The official Instagram first, then one account per persona.`, view: "accounts" });
  else if (!accounts.some((x) => x.posting)) next.push({ title: "Switch posting on", detail: "An account is connected but the factory may not post to it yet. The switch is beside each account.", view: "accounts" });
  if (a.waiting > 0) next.push({ title: `Look through ${a.waiting} photos`, detail: `Only ${a.approved} photos carry every post today, so faces repeat. Approving more is the fastest way to more variety.`, view: "library" });
  if (drafts > 0) next.push({ title: `Read ${drafts} ideas`, detail: "An approved idea becomes a post the next time a day is planned. Nothing is used until you approve it.", view: "ideas" });
  if (b.review > 0) next.push({ title: `Review ${b.review} posts`, detail: "Made and waiting for a yes or a no.", view: "wall" });
  return { product: { id: product.id, name: product.name }, measures, next, totals: { ...b, generations, ads: a.ads } };
}

/** Every idea with where it stands, and whether the library can make it today. */
export async function ideasView(productId: string) {
  const states = await ideaStates();
  const have = new Set((await sql<{ filter_id: string }>("select distinct filter_id from generations")).map((g) => g.filter_id));
  const used = new Set((await sql<{ idea: string }>("select inputs->>'idea' as idea from briefs where product = $1 and inputs->>'idea' is not null", [productId])).map((r) => r.idea));
  const formats = new Map(registry.formats().map((f) => [f.id, f.name]));
  const personas = registry.personas().filter((p) => p.product === productId);
  return {
    personas: personas.map((p) => ({ id: p.id, name: p.name })),
    ideas: registry.ideas(productId).map((i) => ({ ...i, formatName: formats.get(i.format) ?? i.format, state: used.has(i.id) ? "used" : (states.get(i.id) ?? "draft"), waits: !!i.filter && !have.has(i.filter) })),
  };
}

/** Every filter with its prompts, what was seen of it, and two of its results. */
export async function filtersView(productId: string) {
  const lab = registry.lab(productId);
  const overrides = await filterOverrides();
  const isWeak = registry.weak(productId);
  const gens = await sql<{ filter_id: string; variation_id: string; media_key: string; asset: string; at: Date; scores: { realism: number; alignment: number; appeal: number; note: string } | null }>(
    "select g.filter_id, g.variation_id, g.media_key, a.media_key as asset, g.created_at as at, j.result as scores from generations g join assets a on a.id = g.asset_id left join judgements j on j.key = g.key order by g.created_at",
  );
  // What a test left behind: how many results, when the last one was made, and what the reviewer gave them.
  const record = (list: typeof gens) => {
    const scored = list.filter((g) => g.scores).map((g) => overall(g.scores!));
    return { results: list.length, tested: list.length ? new Date(list.at(-1)!.at).toISOString() : null, score: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null };
  };
  return registry.filters(productId).map((f) => {
    const mine = gens.filter((g) => g.filter_id === f.id);
    return {
      id: f.id, name: f.name, category: f.category, benefit: f.benefit, origin: f.origin, why: f.why ?? null,
      approved: overrides.get(f.id) ?? f.approved, audit: lab.audits[f.id] ?? null, ...record(mine),
      variations: f.variations.map((v) => {
        const of = mine.filter((g) => g.variation_id === v.id);
        return { id: v.id, label: v.label, prompt: v.prompt, why: v.why ?? null, replaces: v.replaces ?? null, weak: isWeak(f.id, v.id), ...record(of), examples: of.slice(-3).map((g) => ({ before: `/media/${g.asset}`, after: `/media/${g.media_key}`, score: g.scores ? overall(g.scores) : null, note: g.scores?.note ?? null })) };
      }),
    };
  });
}

/** The library: source photos and the finished ads brought in from Opaque Ads. */
export async function libraryView(productId: string) {
  const rows = await sql<{ id: string; kind: string; media_key: string; approved: boolean; tags: string[]; meta: { source?: string; gender?: string | null; template?: string | null; hook?: string | null }; n: number }>(
    "select a.id, a.kind, a.media_key, a.approved, a.tags, a.meta, (select count(*)::int from generations g where g.asset_id = a.id) as n from assets a where a.product = $1 order by a.kind desc, a.approved desc, a.created_at",
    [productId],
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, url: `/media/${r.media_key}`, video: r.media_key.endsWith(".mp4"), approved: r.approved, tags: r.tags, source: r.meta?.source ?? "opaqueads", gender: r.meta?.gender ?? null, template: r.meta?.template ?? null, hook: r.meta?.hook ?? null, results: r.n }));
}
