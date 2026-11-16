import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { coverPair } from "../align";
import { ctaLayers, type SceneContext } from "../scenes";
import { canvas, overlay, pill, thumb, type Layer } from "../scenes/draw";
import { put } from "../storage";
import type { Slide, Video } from "../types";

const run = promisify(execFile);

/** The encoder: one named in FFMPEG_PATH, else the one shipped with the app, else whatever the machine has. */
async function ffmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const bundled = (await import("ffmpeg-static")).default as unknown as string | null;
    if (bundled && (await fs.access(bundled).then(() => true, () => false))) return bundled;
  } catch {}
  return "ffmpeg";
}

/**
 * The slider: the before held, a line drawn across it that leaves the after
 * behind, the after held, then the closing card. Nothing moves but the line:
 * the two pictures are the same window of a registered pair, so the face
 * stays exactly where it is while the look changes. Timings (seconds) come
 * from the format: beforeHold, wipe, afterHold, cta.
 */
export async function sliderVideo(o: {
  briefId: string; width: number; height: number; before: Buffer; after: Buffer; hook: string; filterLabel: string;
  product: SceneContext["product"]; timings: Record<string, number>;
}): Promise<{ video: Video; slides: Slide[] }> {
  const W = o.width, H = o.height;
  const t = { beforeHold: 0.9, wipe: 1.2, afterHold: 1.3, cta: 1.6, ...o.timings };
  const wipeAt = t.beforeHold, afterAt = wipeAt + t.wipe, ctaAt = afterAt + t.afterHold, total = ctaAt + t.cta;
  const [before, after] = await coverPair(o.before, o.after, W, H);

  // The layers: the hook over the before, the line with its handle, the filter's name over the after, the closing card.
  const hook: Layer[] = o.hook ? await pill(o.hook, { cx: W / 2, cy: Math.round(H * 0.24), size: Math.round(W * 0.05), maxWidth: Math.round(W * 0.82) }) : [];
  const chip: Layer[] = o.filterLabel ? await pill(o.filterLabel, { cx: W / 2, cy: Math.round(H * 0.74), size: Math.round(W * 0.04), maxWidth: Math.round(W * 0.8), weight: "SemiBold" }) : [];
  const card = await ctaLayers({ width: W, height: H, product: o.product, filterLabel: o.filterLabel });
  const knob = 84, lineW = 6;
  const handle = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${knob}" height="${H}"><rect x="${(knob - lineW) / 2}" width="${lineW}" height="${H}" fill="#fff"/><circle cx="${knob / 2}" cy="${H / 2}" r="${knob / 2 - 2}" fill="#fff"/><path d="M${knob / 2 - 9} ${H / 2 - 12} l-12 12 l12 12 M${knob / 2 + 9} ${H / 2 - 12} l12 12 l-12 12" fill="none" stroke="#000" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  );

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "factory-"));
  try {
    const file = (name: string) => path.join(dir, name);
    const { sharp } = await import("../scenes/draw");
    await Promise.all([
      fs.writeFile(file("before.jpg"), before),
      fs.writeFile(file("after.jpg"), after),
      overlay(W, H, hook).then((b) => fs.writeFile(file("hook.png"), b)),
      overlay(W, H, chip).then((b) => fs.writeFile(file("chip.png"), b)),
      overlay(W, H, card).then((b) => fs.writeFile(file("card.png"), b)),
      sharp(handle).png().toBuffer().then((b) => fs.writeFile(file("handle.png"), b)),
    ]);

    // Progress of the line, eased so it starts and lands softly: 0 before the wipe, 1 after it.
    const p = `st(0,clip((t-${wipeAt})/${t.wipe},0,1));ld(0)*ld(0)*(3-2*ld(0))`;
    const still = (name: string) => ["-loop", "1", "-framerate", "30", "-t", String(total), "-i", file(name)];
    const fade = (at: number, out?: number) => `format=rgba,fade=t=in:st=${at}:d=0.25:alpha=1${out != null ? `,fade=t=out:st=${out}:d=0.2:alpha=1` : ""}`;
    const graph = [
      // A mask that is white to the right of the line: the before shows there, the after to its left.
      `color=black:s=${W}x${H}:r=30:d=${total}[mb]`,
      `color=white:s=${W}x${H}:r=30:d=${total}[mw]`,
      `[mb][mw]overlay=x='(${p})*${W}':y=0:eval=frame,format=gray[mask]`,
      `[0:v]format=rgba[b]`,
      `[b][mask]alphamerge[bm]`,
      `[1:v][bm]overlay=0:0[base]`,
      `[5:v]format=rgba[h]`,
      `[base][h]overlay=x='(${p})*${W}-${knob / 2}':y=0:eval=frame:enable='between(t,${wipeAt},${afterAt})'[v1]`,
      `[2:v]format=rgba,fade=t=out:st=${(wipeAt + t.wipe * 0.35).toFixed(2)}:d=0.25:alpha=1[hk]`,
      `[v1][hk]overlay=0:0[v2]`,
      `[3:v]${fade(afterAt, ctaAt - 0.1)}[ch]`,
      `[v2][ch]overlay=0:0[v3]`,
      `[4:v]${fade(ctaAt)}[cd]`,
      `[v3][cd]overlay=0:0,format=yuv420p[out]`,
    ].join(";");
    const args = [
      "-y", "-hide_banner", "-loglevel", "error",
      ...still("before.jpg"), ...still("after.jpg"), ...still("hook.png"), ...still("chip.png"), ...still("card.png"), ...still("handle.png"),
      "-f", "lavfi", "-t", String(total), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex", graph, "-map", "[out]", "-map", "6:a",
      "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-maxrate", "4M", "-bufsize", "8M", "-r", "30", "-c:a", "aac", "-b:a", "64k",
      "-movflags", "+faststart", "-t", String(total), file("out.mp4"),
    ];
    await run(await ffmpeg(), args, { maxBuffer: 16 * 1024 * 1024 }).catch((e: { stderr?: string; message: string }) => {
      throw new Error(`The video could not be made: ${(e.stderr || e.message).trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
    });

    const base = `briefs/${o.briefId}`;
    const key = `${base}/video.mp4`;
    await put(key, await fs.readFile(file("out.mp4")));

    // Three stills of it for the queue: the opening, the line half way, the closing card.
    const half = Math.round(W / 2);
    const leftAfter = await sharp(after).extract({ left: 0, top: 0, width: half, height: H }).toBuffer();
    const stills: [string, Buffer][] = [
      ["opening", await canvas(W, H, [{ input: before, left: 0, top: 0 }, ...hook])],
      ["wipe", await canvas(W, H, [{ input: before, left: 0, top: 0 }, { input: leftAfter, left: 0, top: 0 }, { input: await sharp(handle).png().toBuffer(), left: half - knob / 2, top: 0 }])],
      ["closing", await canvas(W, H, [{ input: after, left: 0, top: 0 }, ...card])],
    ];
    const slides: Slide[] = [];
    for (const [i, [name, jpeg]] of stills.entries()) {
      await put(`${base}/${i + 1}-${name}.jpg`, jpeg);
      await put(`${base}/${i + 1}-${name}.webp`, await thumb(jpeg));
      slides.push({ scene: name, key: `${base}/${i + 1}-${name}.jpg`, thumb: `${base}/${i + 1}-${name}.webp`, width: W, height: H });
    }
    return { video: { key, seconds: +total.toFixed(2), width: W, height: H }, slides };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
