import { coverSet } from "../align";
import type { Value } from "../formats";
import { appIcon, canvas, label, pill, scrim, sharp, type, type Layer } from "./draw";

/**
 * The scenes: the visual building blocks a format's recipe is made of. Each
 * takes the same context and returns one finished frame. A new format is a
 * new recipe over these; a new scene is one more function here. The pairs a
 * scene is given are already registered, and every crop is taken from all
 * sides at once, so before and after always show the same window.
 */
export type ScenePair = { before: Buffer; after: Buffer; filterLabel: string };
export type SceneContext = {
  width: number;
  height: number;
  /** Every pair of the brief. The first is the main one. */
  pairs: ScenePair[];
  hook: string;
  /** A format's second line: the tip, the DM, the admission, the ranking's title. */
  text: string;
  product: { name: string; cta: string; icon: Buffer | null };
  options: Record<string, unknown>;
  /** The format's dials as they stand for this post. */
  tune: Record<string, Value>;
};

type Scene = (c: SceneContext) => Promise<Buffer>;
const margin = (c: SceneContext) => Math.round(c.width * 0.045);
const small = (c: SceneContext) => Math.round(c.width * 0.03);
/** The hook's size: a share of the width as the scene was drawn, scaled by the hook-size dial. */
const hookSize = (c: SceneContext, share: number) => Math.round(c.width * share * (Number(c.tune.hookScale ?? 100) / 100));
const pairOf = (c: SceneContext) => c.pairs[Math.min(c.pairs.length - 1, Number(c.options.pair ?? 0))];
const rect = (w: number, h: number, fill: string, rx = 0, opacity = 1) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${rx}" fill="${fill}" fill-opacity="${opacity}"/></svg>`);
/** A recipe may ask for the brief's own words by name. */
const words = (c: SceneContext, v: unknown) => (v === "hook" ? c.hook : v === "text" ? c.text : typeof v === "string" ? v : "");

/** Before on the left, after on the right, a hairline between them, the hook across the lower third. */
const splitCover: Scene = async (c) => {
  const seam = 4;
  const half = (c.width - seam) / 2;
  const p = pairOf(c);
  const [left, right] = await coverSet([p.before, p.after], half, c.height);
  const m = margin(c);
  const layers: Layer[] = [
    { input: left, left: 0, top: 0 },
    { input: right, left: half + seam, top: 0 },
    { input: rect(seam, c.height, "#FFFFFF"), left: half, top: 0 },
    ...(await label("before", { x: m, y: c.height - m, size: small(c), anchor: "left" })),
    ...(await label("after", { x: c.width - m, y: c.height - m, size: small(c), anchor: "right" })),
  ];
  if (c.options.hook !== false && c.hook) layers.push(...(await pill(c.hook, { cx: c.width / 2, cy: Math.round(c.height * 0.8), size: hookSize(c, 0.047), maxWidth: Math.round(c.width * 0.8) })));
  return canvas(c.width, c.height, layers);
};

/** Before above, after below, the hook across the seam: the whole story in one picture. */
const stack: Scene = async (c) => {
  const seam = 4;
  const half = (c.height - seam) / 2;
  const p = pairOf(c);
  const [top, bottom] = await coverSet([p.before, p.after], c.width, half);
  const m = margin(c);
  const layers: Layer[] = [
    { input: top, left: 0, top: 0 },
    { input: bottom, left: 0, top: half + seam },
    { input: rect(c.width, seam, "#FFFFFF"), left: 0, top: half },
    ...(await label("before", { x: m, y: half - m, size: small(c), anchor: "left" })),
    ...(await label("after", { x: m, y: c.height - m, size: small(c), anchor: "left" })),
  ];
  if (c.hook) layers.push(...(await pill(c.hook, { cx: c.width / 2, cy: half + seam / 2, size: hookSize(c, 0.044), maxWidth: Math.round(c.width * 0.84) })));
  return canvas(c.width, c.height, layers);
};

/**
 * One side of one pair, full frame. It may carry a corner label, the
 * filter's name, a line of words across the top (options.text: "hook",
 * "text" or the words themselves) and a large tag in the corner (options.tag:
 * "good", "1"…).
 */
const full: Scene = async (c) => {
  const p = pairOf(c);
  const m = margin(c);
  const [before, after] = await coverSet([p.before, p.after], c.width, c.height);
  const layers: Layer[] = [{ input: c.options.side === "before" ? before : after, left: 0, top: 0 }];
  if (c.options.label === "before") layers.push(...(await label("before", { x: m, y: c.height - m, size: small(c), anchor: "left" })));
  if (c.options.label === "filter" && p.filterLabel && c.tune.filterName !== "hidden") layers.push(...(await pill(p.filterLabel, { cx: c.width / 2, cy: Math.round(c.height * 0.9), size: Math.round(c.width * 0.036), maxWidth: Math.round(c.width * 0.8), weight: "SemiBold" })));
  const line = words(c, c.options.text);
  if (line) layers.push(...(await pill(line, { cx: c.width / 2, cy: Math.round(c.height * 0.2), size: hookSize(c, 0.047), maxWidth: Math.round(c.width * 0.8) })));
  if (typeof c.options.tag === "string") {
    const numeral = /^\d+$/.test(c.options.tag);
    const t = await type(c.options.tag, { size: Math.round(c.width * (numeral ? 0.2 : 0.085)), weight: "Bold", maxWidth: c.width * 0.8 });
    const shade = await sharp(t.input).extend({ top: 30, bottom: 30, left: 30, right: 30, background: { r: 0, g: 0, b: 0, alpha: 0 } }).tint("#000000").blur(14).toBuffer();
    layers.push({ input: shade, left: m - 30, top: m - 30 }, { input: t.input, left: m, top: m });
  }
  return canvas(c.width, c.height, layers);
};

/** A title over the main after, veiled: the first slide of a carousel that needs to say what it is. */
const title: Scene = async (c) => {
  const p = c.pairs[0];
  const [after] = await coverSet([p.after], c.width, c.height);
  const line = words(c, c.options.from ?? "hook") || c.hook;
  const t = await type(line, { size: hookSize(c, 0.085), weight: "Bold", maxWidth: Math.round(c.width * 0.82) });
  return canvas(c.width, c.height, [{ input: after, left: 0, top: 0 }, scrim(c.width, c.height, 0.42), { input: t.input, left: Math.round((c.width - t.width) / 2), top: Math.round((c.height - t.height) / 2) }]);
};

/** The same photo in four filters, numbered, with the question in the middle. */
const grid: Scene = async (c) => {
  const seam = 4;
  const w = (c.width - seam) / 2, h = (c.height - seam) / 2;
  const four = [0, 1, 2, 3].map((i) => c.pairs[Math.min(i, c.pairs.length - 1)]);
  const cells = await coverSet(four.map((p) => p.after), w, h);
  const layers: Layer[] = [];
  for (const [i, cell] of cells.entries()) {
    const left = (i % 2) * (w + seam), top = Math.floor(i / 2) * (h + seam);
    layers.push({ input: cell, left, top });
    const n = await type(String(i + 1), { size: Math.round(c.width * 0.06), weight: "Bold", color: "#000000", maxWidth: 200 });
    const d = Math.round(c.width * 0.085);
    layers.push({ input: rect(d, d, "#FFFFFF", d / 2), left: left + margin(c), top: top + margin(c) }, { input: n.input, left: Math.round(left + margin(c) + (d - n.width) / 2), top: Math.round(top + margin(c) + (d - n.height) / 2) });
  }
  layers.push({ input: rect(c.width, seam, "#FFFFFF"), left: 0, top: h }, { input: rect(seam, c.height, "#FFFFFF"), left: w, top: 0 });
  if (c.hook) layers.push(...(await pill(c.hook, { cx: c.width / 2, cy: c.height / 2, size: hookSize(c, 0.047), maxWidth: Math.round(c.width * 0.8) })));
  return canvas(c.width, c.height, layers);
};

/** A message someone sent her, and her answer, over the photo they were asking about. */
const dm: Scene = async (c) => {
  const [after] = await coverSet([c.pairs[0].after], c.width, c.height);
  const size = hookSize(c, 0.045);
  const bubble = async (text: string, mine: boolean, top: number) => {
    const t = await type(text, { size, weight: "Medium", color: mine ? "#FFFFFF" : "#000000", maxWidth: Math.round(c.width * 0.58) });
    const padX = Math.round(size * 0.8), padY = Math.round(size * 0.55);
    const w = t.width + padX * 2, h = t.height + padY * 2;
    const left = mine ? c.width - margin(c) * 2 - w : margin(c) * 2;
    return { layers: [{ input: rect(w, h, mine ? "#0A84FF" : "#E9E9EB", Math.round(size * 0.9)), left, top }, { input: t.input, left: left + padX, top: top + padY }] as Layer[], bottom: top + h };
  };
  const first = await bubble(c.text || "how do you edit your photos", false, Math.round(c.height * 0.4));
  const second = await bubble(c.hook, true, first.bottom + Math.round(size * 0.6));
  return canvas(c.width, c.height, [{ input: await sharp(after).blur(18).toBuffer(), left: 0, top: 0 }, scrim(c.width, c.height, 0.35), ...first.layers, ...second.layers]);
};

/** A tip on plain paper: a small label, the title, the tip itself. The one scene with no photo in it. */
const card: Scene = async (c) => {
  const m = Math.round(c.width * 0.1);
  const kicker = await type("one fix", { size: Math.round(c.width * 0.03), weight: "SemiBold", color: "#8A877F", maxWidth: c.width - m * 2, spacing: c.width * 0.002, align: "left" });
  const head = await type(c.hook, { size: hookSize(c, 0.085), weight: "Bold", color: "#141413", maxWidth: c.width - m * 2, align: "left" });
  const body = await type(c.text, { size: Math.round(c.width * 0.044), weight: "Medium", color: "#3F3E3A", maxWidth: c.width - m * 2, align: "left" });
  const top = Math.round((c.height - (kicker.height + head.height + body.height + c.width * 0.07)) / 2);
  return canvas(c.width, c.height, [
    { input: rect(c.width, c.height, "#F4F1EA"), left: 0, top: 0 },
    { input: kicker.input, left: m, top },
    { input: head.input, left: m, top: top + kicker.height + Math.round(c.width * 0.02) },
    { input: body.input, left: m, top: top + kicker.height + head.height + Math.round(c.width * 0.06) },
  ]);
};

/** The layers of the closing card, shared by the last slide and the last seconds of a video: the icon, the name, the filter, and what to do. */
export async function ctaLayers(c: { width: number; height: number; product: SceneContext["product"]; filterLabel: string }): Promise<Layer[]> {
  const cx = c.width / 2;
  const iconSize = Math.round(c.width * 0.2);
  const layers: Layer[] = [scrim(c.width, c.height, 0.5)];
  let y = Math.round(c.height * 0.36);
  if (c.product.icon) {
    layers.push({ input: await appIcon(c.product.icon, iconSize), left: Math.round(cx - iconSize / 2), top: y });
    y += iconSize + Math.round(c.width * 0.035);
  }
  const name = await type(c.product.name, { size: Math.round(c.width * 0.075), weight: "Bold", maxWidth: c.width * 0.8 });
  layers.push({ input: name.input, left: Math.round(cx - name.width / 2), top: y });
  y += name.height + Math.round(c.width * 0.01);
  if (c.filterLabel) {
    const line = await type(`The ${c.filterLabel.split(" · ")[0]} filter`, { size: Math.round(c.width * 0.036), weight: "Medium", opacity: 0.85, maxWidth: c.width * 0.8 });
    layers.push({ input: line.input, left: Math.round(cx - line.width / 2), top: y });
    y += line.height;
  }
  if (c.product.cta) layers.push(...(await pill(c.product.cta, { cx, cy: y + Math.round(c.width * 0.085), size: Math.round(c.width * 0.036), maxWidth: c.width * 0.8, fill: "#FFFFFF", color: "#000000", weight: "SemiBold" })));
  return layers;
}

/** The closing slide: the after, veiled, with what the post is selling and what to do about it. */
const cta: Scene = async (c) => {
  const p = c.pairs[0];
  const [after] = await coverSet([p.after], c.width, c.height);
  return canvas(c.width, c.height, [{ input: after, left: 0, top: 0 }, ...(await ctaLayers({ width: c.width, height: c.height, product: c.product, filterLabel: c.pairs.length === 1 ? p.filterLabel : "" }))]);
};

export const SCENES: Record<string, Scene> = { "split-cover": splitCover, stack, full, title, grid, dm, card, cta };
