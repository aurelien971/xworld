import fs from "node:fs";
import path from "node:path";
import { REGISTRY } from "../paths";
import { SCENES, type SceneContext } from "../scenes";
import { sharp, thumb } from "../scenes/draw";
import { put } from "../storage";
import type { Format, Product, Slide, Video } from "../types";
import { sliderVideo } from "./video";

/** What a scene needs to know about the product: its name, what it asks for, and its icon. */
export function productContext(p: Product): SceneContext["product"] {
  const file = p.icon ? path.join(REGISTRY, "products", p.id, p.icon) : null;
  return { name: p.name, cta: p.cta, icon: file && fs.existsSync(file) ? fs.readFileSync(file) : null };
}

/**
 * A format run over one registered pair. A slide format's recipe becomes
 * finished slides, each with a small preview; a video format becomes its
 * file and three stills of it.
 */
export async function compose(o: { briefId: string; format: Format; product: Product; before: Buffer; after: Buffer; hook: string; filterLabel: string }): Promise<{ slides: Slide[]; video: Video | null }> {
  const product = productContext(o.product);
  const { width, height } = o.format.size;
  if (o.format.video) {
    if (o.format.video.renderer !== "slider") throw new Error(`The format "${o.format.id}" asks for a video renderer "${o.format.video.renderer}" that does not exist.`);
    return sliderVideo({ briefId: o.briefId, width, height, before: o.before, after: o.after, hook: o.hook, filterLabel: o.filterLabel, product, timings: o.format.video.options });
  }
  const slides: Slide[] = [];
  for (const [i, step] of o.format.scenes.entries()) {
    const scene = SCENES[step.scene];
    if (!scene) throw new Error(`The format "${o.format.id}" asks for a scene "${step.scene}" that does not exist.`);
    const jpeg = await scene({ width, height, before: o.before, after: o.after, hook: o.hook, filterLabel: o.filterLabel, product, options: step.options });
    const base = `briefs/${o.briefId}/${i + 1}-${step.scene}`;
    const meta = await sharp(jpeg).metadata();
    await put(`${base}.jpg`, jpeg);
    await put(`${base}.webp`, await thumb(jpeg));
    slides.push({ scene: step.scene, key: `${base}.jpg`, thumb: `${base}.webp`, width: meta.width!, height: meta.height! });
  }
  return { slides, video: null };
}
