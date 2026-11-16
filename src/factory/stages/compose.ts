import { SCENES } from "../scenes";
import { thumb, sharp } from "../scenes/draw";
import { put } from "../storage";
import type { Format, Slide } from "../types";

/** A format's recipe run over one pair: each scene becomes a finished slide and a small preview of it. */
export async function compose(o: { briefId: string; format: Format; before: Buffer; after: Buffer; hook: string; filterLabel: string }): Promise<Slide[]> {
  const slides: Slide[] = [];
  for (const [i, step] of o.format.scenes.entries()) {
    const scene = SCENES[step.scene];
    if (!scene) throw new Error(`The format "${o.format.id}" asks for a scene "${step.scene}" that does not exist.`);
    const jpeg = await scene({ width: o.format.size.width, height: o.format.size.height, before: o.before, after: o.after, hook: o.hook, filterLabel: o.filterLabel, options: step.options });
    const base = `briefs/${o.briefId}/${i + 1}-${step.scene}`;
    const meta = await sharp(jpeg).metadata();
    await put(`${base}.jpg`, jpeg);
    await put(`${base}.webp`, await thumb(jpeg));
    slides.push({ scene: step.scene, key: `${base}.jpg`, thumb: `${base}.webp`, width: meta.width!, height: meta.height! });
  }
  return slides;
}
