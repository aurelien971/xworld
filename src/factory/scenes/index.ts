import { canvas, cover, label, pill, type Layer } from "./draw";

/**
 * The scenes: the visual building blocks a format's recipe is made of. Each
 * takes the same context and returns one finished frame. A new format is a
 * new recipe over these; a new scene is one more function here.
 */
export type SceneContext = {
  width: number;
  height: number;
  before: Buffer;
  after: Buffer;
  hook: string;
  filterLabel: string;
  options: Record<string, unknown>;
};

type Scene = (c: SceneContext) => Promise<Buffer>;

/** Before on the left, after on the right, a hairline between them, the hook across the lower third. */
const splitCover: Scene = async (c) => {
  const seam = 4;
  const half = (c.width - seam) / 2;
  const [left, right] = await Promise.all([cover(c.before, half, c.height), cover(c.after, half, c.height)]);
  const white = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${seam}" height="${c.height}"><rect width="${seam}" height="${c.height}" fill="#FFFFFF"/></svg>`);
  const m = Math.round(c.width * 0.045);
  const layers: Layer[] = [
    { input: left, left: 0, top: 0 },
    { input: right, left: half + seam, top: 0 },
    { input: white, left: half, top: 0 },
    ...(await label("before", { x: m, y: c.height - m, size: Math.round(c.width * 0.03), anchor: "left" })),
    ...(await label("after", { x: c.width - m, y: c.height - m, size: Math.round(c.width * 0.03), anchor: "right" })),
  ];
  if (c.options.hook !== false && c.hook) {
    layers.push(...(await pill(c.hook, { cx: c.width / 2, cy: Math.round(c.height * 0.8), size: Math.round(c.width * 0.047), maxWidth: Math.round(c.width * 0.8) })));
  }
  return canvas(c.width, c.height, layers);
};

/** One side, full frame. The before carries a corner label; the after names the filter. */
const full: Scene = async (c) => {
  const side = c.options.side === "before" ? "before" : "after";
  const m = Math.round(c.width * 0.045);
  const layers: Layer[] = [{ input: await cover(side === "before" ? c.before : c.after, c.width, c.height), left: 0, top: 0 }];
  if (c.options.label === "before") layers.push(...(await label("before", { x: m, y: c.height - m, size: Math.round(c.width * 0.03), anchor: "left" })));
  if (c.options.label === "filter" && c.filterLabel) {
    layers.push(...(await pill(c.filterLabel, { cx: c.width / 2, cy: Math.round(c.height * 0.9), size: Math.round(c.width * 0.036), maxWidth: Math.round(c.width * 0.8), weight: "SemiBold" })));
  }
  return canvas(c.width, c.height, layers);
};

export const SCENES: Record<string, Scene> = { "split-cover": splitCover, full };
