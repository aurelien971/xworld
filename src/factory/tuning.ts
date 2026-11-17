import { sql } from "./db";
import { AXES, base, clean, code, criteria, setting, settingsFor, words, type Criteria, type Setting, type Value } from "./formats";
import * as registry from "./registry";
import type { Format } from "./types";

/**
 * The dials, set. A dial's value comes from the narrowest place that has
 * one: this post, then its format, then everything, then the format's own
 * file. Setting a dial for a wider place clears it in the narrower ones, so
 * "apply to all" really reaches all.
 */
export type Origin = "default" | "all" | "format" | "post";
export type Scope = "post" | "format" | "all";
export type SettingView = Setting & { value: Value; from: Origin };
export type Tuning = {
  format: { id: string; name: string };
  settings: SettingView[];
  /** Posts not out yet, by format: what a change would make again. */
  posts: Record<string, number>;
  /** Which formats have each dial. */
  uses: Record<string, string[]>;
};

type Overrides = Map<string, Value>;
export const overrides = async (): Promise<Overrides> => new Map((await sql<{ scope: string; key: string; value: Value }>("select scope, key, value from settings")).map((r) => [`${r.scope}|${r.key}`, r.value]));

export function resolve(f: Format, rows: Overrides, briefId?: string) {
  const values: Record<string, Value> = {}, from: Record<string, Origin> = {};
  const places: [Origin, string][] = [...(briefId ? [["post", `brief:${briefId}`] as [Origin, string]] : []), ["format", `format:${f.id}`], ["all", "all"]];
  for (const id of settingsFor(f)) {
    const hit = places.find(([, scope]) => rows.has(`${scope}|${id}`));
    values[id] = hit ? rows.get(`${hit[1]}|${id}`)! : base(f, id);
    from[id] = hit ? hit[0] : "default";
  }
  return { values, from };
}

/** The values a brief is made with. */
export const valuesFor = async (formatId: string, briefId: string) => resolve(registry.format(formatId), await overrides(), briefId).values;

const NOT_OUT = "state <> 'published' and publish is null and jsonb_array_length(slides) > 0";
const waiting = async () => Object.fromEntries((await sql<{ format: string; n: number }>(`select format, count(*)::int as n from briefs where ${NOT_OUT} group by 1`)).map((r) => [r.format, r.n]));
const uses = (formats: Format[]) => Object.fromEntries([...new Set(formats.flatMap(settingsFor))].map((id) => [id, formats.filter((f) => settingsFor(f).includes(id)).map((f) => f.id)]));
const settingViews = (f: Format, rows: Overrides, briefId?: string): SettingView[] => {
  const r = resolve(f, rows, briefId);
  return settingsFor(f).map((id) => ({ ...setting(id)!, value: r.values[id], from: r.from[id] }));
};

export async function tuningOf(formatId: string, briefId: string): Promise<Tuning> {
  const formats = registry.formats();
  const f = formats.find((x) => x.id === formatId)!;
  return { format: { id: f.id, name: f.name }, settings: settingViews(f, await overrides(), briefId), posts: await waiting(), uses: uses(formats) };
}

/**
 * Set dials at one place (null puts a dial back to what the next wider place
 * says). Returns the posts that now look different and should be made again.
 */
export async function tune(where: { scope: Scope; brief?: string; format: string }, changes: Record<string, unknown>): Promise<string[]> {
  const f = registry.format(where.format);
  const place = where.scope === "post" ? `brief:${where.brief}` : where.scope === "format" ? `format:${f.id}` : "all";
  const keys = Object.keys(changes).filter((k) => settingsFor(f).includes(k));
  if (!keys.length) throw new Error("Nothing to change.");
  for (const key of keys) {
    if (changes[key] === null) {
      await sql("delete from settings where scope = $1 and key = $2", [place, key]);
      continue;
    }
    await sql("insert into settings (scope, key, value) values ($1,$2,$3) on conflict (scope, key) do update set value = excluded.value, at = now()", [place, key, JSON.stringify(clean(key, changes[key]))]);
    if (where.scope === "all") await sql("delete from settings where key = $1 and scope <> 'all'", [key]);
    if (where.scope === "format") await sql("delete from settings where key = $1 and scope in (select 'brief:' || id from briefs where format = $2)", [key, f.id]);
  }
  if (where.scope === "post") return [where.brief!];
  const touched = where.scope === "format" ? [f.id] : registry.formats().filter((x) => settingsFor(x).some((k) => keys.includes(k))).map((x) => x.id);
  return (await sql<{ id: string }>(`select id from briefs where ${NOT_OUT} and format = any($1) order by day desc, seq`, [touched])).map((r) => r.id);
}

/** Every format as its combination, with its dials as they stand, and the grid of combinations in play. */
export type FormatView = {
  id: string; name: string; code: string; words: string[]; criteria: Criteria; platforms: string[]; size: string;
  made: number; waiting: number; settings: SettingView[];
  /** Another format that is the same combination, if a change has made two of them alike. */
  twin: string | null;
};
export type FormatsView = { axes: typeof AXES; formats: FormatView[]; posts: Record<string, number>; uses: Record<string, string[]>; remaking: number };

export async function formatsView(productId: string, remaking: number): Promise<FormatsView> {
  const formats = registry.formats();
  const rows = await overrides();
  const made = Object.fromEntries((await sql<{ format: string; n: number }>("select format, count(*)::int as n from briefs where product = $1 and jsonb_array_length(slides) > 0 group by 1", [productId])).map((r) => [r.format, r.n]));
  const posts = await waiting();
  const list = formats.map((f) => {
    const c = criteria(f, resolve(f, rows).values);
    return { id: f.id, name: f.name, code: code(c), words: words(c), criteria: c, platforms: f.platforms, size: `${f.size.width}×${f.size.height}`, made: made[f.id] ?? 0, waiting: posts[f.id] ?? 0, settings: settingViews(f, rows), twin: null as string | null };
  });
  for (const f of list) f.twin = list.find((o) => o.id !== f.id && o.code === f.code)?.name ?? null;
  return { axes: AXES, formats: list, posts, uses: uses(formats), remaking };
}
