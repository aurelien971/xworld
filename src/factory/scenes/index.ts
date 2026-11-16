import { coverPair } from "../align";
import { appIcon, canvas, label, pill, scrim, type, type Layer } from "./draw";

/**
 * The scenes: the visual building blocks a format's recipe is made of. Each
 * takes the same context and returns one finished frame. A new format is a
 * new recipe over these; a new scene is one more function here. The pair a
 * scene is given is already registered, and every crop is taken from both
 * sides at once, so before and after always show the same window.
 */
export type SceneContext = {
  width: number;
  height: number;
  before: Buffer;
  after: Buffer;
  hook: string;
  filterLabel: string;
  product: { name: string; cta: string; icon: Buffer | null };
  options: Record<string, unknown>;
};

type Scene = (c: SceneContext) => Promise<Buffer>;
const margin = (c: SceneContext) => Math.round(c.width * 0.045);
const small = (c: SceneContext) => Math.round(c.width * 0.03);

/** Before on the left, after on the right, a hairline between them, the hook across the lower third. */
const splitCover: Scene = async (c) => {
  const seam = 4;
  const half = (c.width - seam) / 2;
  const [left, right] = await coverPair(c.before, c.after, half, c.height);
  const white = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${seam}" height="${c.height}"><rect width="${seam}" height="${c.height}" fill="#FFFFFF"/></svg>`);
  const m = margin(c);
  const layers: Layer[] = [
    { input: left, left: 0, top: 0 },
    { input: right, left: half + seam, top: 0 },
    { input: white, left: half, top: 0 },
    ...(await label("before", { x: m, y: c.height - m, size: small(c), anchor: "left" })),
    ...(await label("after", { x: c.width - m, y: c.height - m, size: small(c), anchor: "right" })),
  ];
  if (c.options.hook !== false && c.hook) layers.push(...(await pill(c.hook, { cx: c.width / 2, cy: Math.round(c.height * 0.8), size: Math.round(c.width * 0.047), maxWidth: Math.round(c.width * 0.8) })));
  return canvas(c.width, c.height, layers);
};

/** Before above, after below, the hook across the seam: the whole story in one picture. */
const stack: Scene = async (c) => {
  const seam = 4;
  const half = (c.height - seam) / 2;
  const [top, bottom] = await coverPair(c.before, c.after, c.width, half);
  const white = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${seam}"><rect width="${c.width}" height="${seam}" fill="#FFFFFF"/></svg>`);
  const m = margin(c);
  const layers: Layer[] = [
    { input: top, left: 0, top: 0 },
    { input: bottom, left: 0, top: half + seam },
    { input: white, left: 0, top: half },
    ...(await label("before", { x: m, y: half - m, size: small(c), anchor: "left" })),
    ...(await label("after", { x: m, y: c.height - m, size: small(c), anchor: "left" })),
  ];
  if (c.hook) layers.push(...(await pill(c.hook, { cx: c.width / 2, cy: half + seam / 2, size: Math.round(c.width * 0.044), maxWidth: Math.round(c.width * 0.84) })));
  return canvas(c.width, c.height, layers);
};

/** One side, full frame. A corner label, the filter's name, or a line of its own (options.text). */
const full: Scene = async (c) => {
  const side = c.options.side === "before" ? 0 : 1;
  const m = margin(c);
  const layers: Layer[] = [{ input: (await coverPair(c.before, c.after, c.width, c.height))[side], left: 0, top: 0 }];
  if (c.options.label === "before") layers.push(...(await label("before", { x: m, y: c.height - m, size: small(c), anchor: "left" })));
  if (c.options.label === "filter" && c.filterLabel) layers.push(...(await pill(c.filterLabel, { cx: c.width / 2, cy: Math.round(c.height * 0.9), size: Math.round(c.width * 0.036), maxWidth: Math.round(c.width * 0.8), weight: "SemiBold" })));
  if (typeof c.options.text === "string") layers.push(...(await pill(c.options.text, { cx: c.width / 2, cy: Math.round(c.height * 0.2), size: Math.round(c.width * 0.047), maxWidth: Math.round(c.width * 0.8) })));
  return canvas(c.width, c.height, layers);
};

/** The layers of the closing card, shared by the last slide and the last seconds of a video: the icon, the name, the filter, and what to do. */
export async function ctaLayers(c: Pick<SceneContext, "width" | "height" | "product" | "filterLabel">): Promise<Layer[]> {
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
  const [, after] = await coverPair(c.before, c.after, c.width, c.height);
  return canvas(c.width, c.height, [{ input: after, left: 0, top: 0 }, ...(await ctaLayers(c))]);
};

export const SCENES: Record<string, Scene> = { "split-cover": splitCover, stack, full, cta };
