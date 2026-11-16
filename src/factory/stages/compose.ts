import fs from "node:fs";
import path from "node:path";
import { coverSet } from "../align";
import { REGISTRY } from "../paths";
import { SCENES, type SceneContext, type ScenePair } from "../scenes";
import { sharp, thumb } from "../scenes/draw";
import { put } from "../storage";
import type { Format, Product, Slide, Video } from "../types";
import { sequenceVideo, type Sequence, type Transition } from "./video";

/** What a scene needs to know about the product: its name, what it asks for, and its icon. */
export function productContext(p: Product): SceneContext["product"] {
  const file = p.icon ? path.join(REGISTRY, "products", p.id, p.icon) : null;
  return { name: p.name, cta: p.cta, icon: file && fs.existsSync(file) ? fs.readFileSync(file) : null };
}

/**
 * The frames of a video, in order, for each way a video format can be
 * planned. Frames of one photo are cut from the same window, so they lie
 * exactly over each other.
 *   single  before, then its after
 *   flash   the same, the after arriving on a white flash
 *   run     one photo: before, then each filter in turn
 *   photos  several photos with one filter: each before, then its after
 */
async function sequenceFor(plan: string, pairs: ScenePair[], width: number, height: number, hook: string, timings: Record<string, number>): Promise<Sequence> {
  const t = { hold: 0.9, wipe: 1.2, rest: 1.3, cta: 1.6, ...timings };
  if (plan === "run") {
    const frames = await coverSet([pairs[0].before, ...pairs.map((p) => p.after)], width, height);
    return { frames, transitions: pairs.map(() => "wipe" as Transition), labels: [null, ...pairs.map((p) => p.filterLabel)], hook, timings: t };
  }
  if (plan === "photos") {
    const frames: Buffer[] = [], transitions: Transition[] = [], labels: (string | null)[] = [];
    for (const [i, p] of pairs.entries()) {
      const [b, a] = await coverSet([p.before, p.after], width, height);
      if (i > 0) transitions.push("cut");
      frames.push(b, a);
      transitions.push("wipe");
      labels.push(null, i === pairs.length - 1 ? p.filterLabel : null);
    }
    return { frames, transitions, labels, hook, timings: t };
  }
  const [b, a] = await coverSet([pairs[0].before, pairs[0].after], width, height);
  return { frames: [b, a], transitions: [plan === "flash" ? "flash" : "wipe"], labels: [null, pairs[0].filterLabel], hook, timings: t };
}

/**
 * A format run over a brief's registered pairs. A slide format's recipe
 * becomes finished slides, each with a small preview; a video format
 * becomes its file and three stills of it.
 */
export async function compose(o: { briefId: string; format: Format; product: Product; pairs: ScenePair[]; hook: string; text: string }): Promise<{ slides: Slide[]; video: Video | null }> {
  const product = productContext(o.product);
  const { width, height } = o.format.size;
  if (o.format.video) {
    const sequence = await sequenceFor(o.format.video.plan, o.pairs, width, height, o.hook, o.format.video.options);
    // The closing card names the filter only when the video showed one.
    const one = new Set(o.pairs.map((p) => p.filterLabel)).size === 1;
    return sequenceVideo({ briefId: o.briefId, width, height, sequence, product, ctaLabel: one ? o.pairs[0].filterLabel : "" });
  }
  const slides: Slide[] = [];
  for (const [i, step] of o.format.scenes.entries()) {
    const scene = SCENES[step.scene];
    if (!scene) throw new Error(`The format "${o.format.id}" asks for a scene "${step.scene}" that does not exist.`);
    const jpeg = await scene({ width, height, pairs: o.pairs, hook: o.hook, text: o.text, product, options: step.options });
    const base = `briefs/${o.briefId}/${i + 1}-${step.scene}`;
    const meta = await sharp(jpeg).metadata();
    await put(`${base}.jpg`, jpeg);
    await put(`${base}.webp`, await thumb(jpeg));
    slides.push({ scene: step.scene, key: `${base}.jpg`, thumb: `${base}.webp`, width: meta.width!, height: meta.height! });
  }
  return { slides, video: null };
}
