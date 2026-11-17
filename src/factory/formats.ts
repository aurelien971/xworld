import type { Format } from "./types";

/**
 * What a format is, said two ways, both read off its recipe so neither can
 * drift from what is actually made.
 *
 *   criteria  the combination a format stands for: its medium, what it
 *             compares, how the result arrives, how it opens, its pace and
 *             how it ends. The combination is the format's real name; two
 *             formats with the same combination are the same format.
 *   settings  the dials of a format: timings, the slider, the words. Each
 *             has a value from the format's file, which can be set again
 *             for everything, for one format, or for one post.
 *
 * Nothing here touches the database or the disk, so the screen reads it too.
 */
export type Value = number | string;
type Base = { id: string; label: string; help: string };
export type Setting =
  | (Base & { kind: "number"; unit: string; min: number; max: number; step: number; fallback: number })
  | (Base & { kind: "choice"; options: { id: string; label: string }[]; fallback: string });

const shown = [{ id: "shown", label: "Shown" }, { id: "hidden", label: "Hidden" }];
export const SETTINGS: Setting[] = [
  { id: "hold", kind: "number", label: "Opening hold", help: "How long the first photo is held before anything changes.", unit: "s", min: 0.2, max: 4, step: 0.1, fallback: 0.9 },
  { id: "wipe", kind: "number", label: "Slider speed", help: "How long the line takes to cross the photo.", unit: "s", min: 0.2, max: 4, step: 0.1, fallback: 1.2 },
  { id: "rest", kind: "number", label: "Result hold", help: "How long each result is held once it has arrived.", unit: "s", min: 0.2, max: 5, step: 0.1, fallback: 1.3 },
  { id: "cta", kind: "number", label: "Closing card", help: "How long the app card stays at the end. At 0 there is none and the video loops.", unit: "s", min: 0, max: 4, step: 0.1, fallback: 1.6 },
  { id: "flash", kind: "number", label: "Flash length", help: "How long the white flash takes to clear.", unit: "s", min: 0.1, max: 1, step: 0.05, fallback: 0.3 },
  { id: "direction", kind: "choice", label: "Slider direction", help: "Which way the line travels.", options: [{ id: "ltr", label: "Left to right" }, { id: "rtl", label: "Right to left" }], fallback: "ltr" },
  { id: "ease", kind: "choice", label: "Slider motion", help: "Eased starts and ends gently; even moves at one speed.", options: [{ id: "eased", label: "Eased" }, { id: "linear", label: "Even" }], fallback: "eased" },
  { id: "handle", kind: "choice", label: "Slider handle", help: "The white line and knob that travel with the change.", options: shown, fallback: "shown" },
  { id: "hookScale", kind: "number", label: "Hook size", help: "The size of the hook, against how the format was drawn.", unit: "%", min: 60, max: 160, step: 5, fallback: 100 },
  { id: "hookAt", kind: "number", label: "Hook height", help: "Where the hook sits, from the top of the frame.", unit: "%", min: 8, max: 88, step: 1, fallback: 24 },
  { id: "filterName", kind: "choice", label: "Filter name", help: "Whether the filter's name is written on the result.", options: shown, fallback: "shown" },
];
export const setting = (id: string) => SETTINGS.find((s) => s.id === id);

/** The dials a format has, in the order they are shown. A format only has the ones its recipe uses. */
export function settingsFor(f: Format): string[] {
  if (f.video) return f.video.plan === "flash" ? ["hold", "rest", "cta", "flash", "hookScale", "hookAt", "filterName"] : ["hold", "wipe", "rest", "cta", "direction", "ease", "handle", "hookScale", "hookAt", "filterName"];
  return ["hookScale", ...(f.scenes.some((s) => s.options.label === "filter") ? ["filterName"] : [])];
}

/** A dial's value as the format's own file gives it. */
export const base = (f: Format, id: string): Value => f.video?.options[id] ?? setting(id)!.fallback;

/** A value made safe for a dial: a number inside its range and on its step, a choice that exists. */
export function clean(id: string, raw: unknown): Value {
  const s = setting(id);
  if (!s) throw new Error(`There is no setting "${id}".`);
  if (s.kind === "choice") {
    if (!s.options.some((o) => o.id === raw)) throw new Error(`${s.label} cannot be "${String(raw)}".`);
    return raw as string;
  }
  const n = Number(raw);
  if (raw === "" || raw == null || !Number.isFinite(n)) throw new Error(`${s.label} needs a number.`);
  return +(Math.round(Math.min(s.max, Math.max(s.min, n)) / s.step) * s.step).toFixed(2);
}

/** The criteria, each with the values it can take. */
export const AXES = [
  { id: "medium", label: "Medium", values: { video: "Video", carousel: "Carousel", still: "Single picture" } },
  { id: "subject", label: "Compares", values: { pair: "One photo, one filter", filters: "One photo, several filters", photos: "Several photos, one filter" } },
  { id: "reveal", label: "Reveal", values: { slider: "Slider", flash: "Flash cut", swipe: "Swipe", side: "Side by side", after: "Results only" } },
  { id: "opening", label: "Opens with", values: { hook: "Hook on the photo", title: "Title card", message: "Message", tip: "Tip card", bare: "No words" } },
  { id: "pace", label: "Pace", values: { quick: "Quick", steady: "Steady", slow: "Slow", none: "Still" } },
  { id: "ending", label: "Ends with", values: { card: "App card", loop: "Loop", open: "No card" } },
] as const;
export type Axis = (typeof AXES)[number]["id"];
export type Criteria = Record<Axis, string>;

/** A format's combination, read off its recipe and the values its dials have now. */
export function criteria(f: Format, values: Record<string, Value>): Criteria {
  const scenes = f.scenes.map((s) => s.scene);
  const first = f.scenes[0];
  const sides = new Set(f.scenes.filter((s) => s.scene === "full").map((s) => s.options.side));
  const beat = Number(f.video?.plan === "flash" ? values.hold : values.wipe);
  return {
    medium: f.video ? "video" : scenes.length === 1 ? "still" : "carousel",
    subject: f.needs ? (f.needs.mode === "same-asset" ? "filters" : "photos") : "pair",
    reveal: f.video ? (f.video.plan === "flash" ? "flash" : "slider") : scenes.some((s) => ["split-cover", "stack", "grid"].includes(s)) ? "side" : sides.has("before") ? "swipe" : "after",
    opening: f.video ? "hook" : first?.scene === "title" ? "title" : first?.scene === "dm" ? "message" : first?.scene === "card" ? "tip" : first?.scene === "full" && !first.options.text ? "bare" : "hook",
    pace: f.video ? (beat < 1 ? "quick" : beat <= 1.6 ? "steady" : "slow") : "none",
    ending: f.video ? (Number(values.cta) > 0 ? "card" : "loop") : scenes.at(-1) === "cta" ? "card" : "open",
  };
}

/** The combination as one short code, the same for any two formats that are the same thing. */
export const code = (c: Criteria) => AXES.map((a) => c[a.id]).filter((v) => v !== "none").join("/");
/** The combination in words. */
export const words = (c: Criteria) => AXES.filter((a) => c[a.id] !== "none").map((a) => (a.values as Record<string, string>)[c[a.id]]);
