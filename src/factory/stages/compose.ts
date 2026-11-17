import fs from "node:fs";
import path from "node:path";
import { coverSet } from "../align";
import type { Value } from "../formats";
import { REGISTRY } from "../paths";
import { SCENES, type SceneContext, type ScenePair } from "../scenes";
import { sharp, thumb } from "../scenes/draw";
import { put } from "../storage";
import type { Format, Product, Slide, Video } from "../types";
import { sequenceVideo, type Look, type Sequence, type Transition } from "./video";

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
async function sequenceFor(plan: string, all: ScenePair[], width: number, height: number, hook: string, tune: Record<string, Value>): Promise<Sequence> {
  const n = (id: string, otherwise: number) => (tune[id] == null ? otherwise : Number(tune[id]));
  const t = { hold: n("hold", 0.9), wipe: n("wipe", 0), rest: n("rest", 1.3), cta: n("cta", 1.6) };
  const look: Look = { direction: tune.direction === "rtl" ? "rtl" : "ltr", eased: tune.ease !== "linear", handle: tune.handle !== "hidden", hookScale: n("hookScale", 100) / 100, hookAt: n("hookAt", 24) / 100, flash: n("flash", 0.3) };
  // With the filter's name switched off, no frame carries one.
  const pairs = tune.filterName === "hidden" ? all.map((p) => ({ ...p, filterLabel: "" })) : all;
  if (plan === "run") {
    const frames = await coverSet([pairs[0].before, ...pairs.map((p) => p.after)], width, height);
    return { frames, transitions: pairs.map(() => "wipe" as Transition), labels: [null, ...pairs.map((p) => p.filterLabel || null)], hook, timings: t, look };
  }
  if (plan === "photos") {
    const frames: Buffer[] = [], transitions: Transition[] = [], labels: (string | null)[] = [];
    for (const [i, p] of pairs.entries()) {
      const [b, a] = await coverSet([p.before, p.after], width, height);
      if (i > 0) transitions.push("cut");
      frames.push(b, a);
      transitions.push("wipe");
      labels.push(null, i === pairs.length - 1 ? p.filterLabel || null : null);
    }
    return { frames, transitions, labels, hook, timings: t, look };
  }
  const [b, a] = await coverSet([pairs[0].before, pairs[0].after], width, height);
  return { frames: [b, a], transitions: [plan === "flash" ? "flash" : "wipe"], labels: [null, pairs[0].filterLabel || null], hook, timings: t, look };
}

/**
 * A format run over a brief's registered pairs. A slide format's recipe
 * becomes finished slides, each with a small preview; a video format
 * becomes its file and three stills of it.
 */
export async function compose(o: { briefId: string; format: Format; product: Product; pairs: ScenePair[]; hook: string; text: string; tune: Record<string, Value> }): Promise<{ slides: Slide[]; video: Video | null }> {
  const product = productContext(o.product);
  // Every make has its own folder, so a remade post is never mistaken for the one before it.
  const base = `briefs/${o.briefId}/${Date.now().toString(36)}`;
  const { width, height } = o.format.size;
  if (o.format.video) {
    const sequence = await sequenceFor(o.format.video.plan, o.pairs, width, height, o.hook, o.tune);
    // The closing card names the filter only when the video showed one.
    const one = new Set(o.pairs.map((p) => p.filterLabel)).size === 1;
    return sequenceVideo({ base, width, height, sequence, product, ctaLabel: one ? o.pairs[0].filterLabel : "" });
  }
  const slides: Slide[] = [];
  for (const [i, step] of o.format.scenes.entries()) {
    const scene = SCENES[step.scene];
    if (!scene) throw new Error(`The format "${o.format.id}" asks for a scene "${step.scene}" that does not exist.`);
    const jpeg = await scene({ width, height, pairs: o.pairs, hook: o.hook, text: o.text, product, options: step.options, tune: o.tune });
    const file = `${base}/${i + 1}-${step.scene}`;
    const meta = await sharp(jpeg).metadata();
    await put(`${file}.jpg`, jpeg);
    await put(`${file}.webp`, await thumb(jpeg));
    slides.push({ scene: step.scene, key: `${file}.jpg`, thumb: `${file}.webp`, width: meta.width!, height: meta.height! });
  }
  return { slides, video: null };
}
