import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ctaLayers, type SceneContext } from "../scenes";
import { canvas, overlay, pill, sharp, thumb, type Layer } from "../scenes/draw";
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

/** How one frame gives way to the next: a line drawn across, a white flash, or a plain cut. */
export type Transition = "wipe" | "flash" | "cut";
/** How the video is drawn, apart from its timings: the slider's direction and motion, the hook's size and place, the flash. */
export type Look = { direction: "ltr" | "rtl"; eased: boolean; handle: boolean; hookScale: number; hookAt: number; flash: number };
export type Sequence = {
  /** Finished frames at the video's size, in order. */
  frames: Buffer[];
  /** How each frame after the first arrives. One fewer than frames. */
  transitions: Transition[];
  /** A name shown over a frame while it is held (a filter's name), by frame. */
  labels: (string | null)[];
  hook: string;
  /** Seconds: a frame arrived at by a cut is held for `hold`, a wipe lasts `wipe`, a revealed frame rests for `rest`, the closing card for `cta` (0: none, the video loops). */
  timings: { hold: number; wipe: number; rest: number; cta: number };
  look: Look;
};

/**
 * A sequence of frames into a video. Nothing moves but the line: every
 * frame of one photo is the same window of a registered set, so the face
 * stays exactly where it is while the look changes around it. One renderer
 * for every video format: a single slider, a flash cut, three filters in a
 * row, one filter across three photos.
 */
export async function sequenceVideo(o: { base: string; width: number; height: number; sequence: Sequence; product: SceneContext["product"]; ctaLabel: string }): Promise<{ video: Video; slides: Slide[] }> {
  const W = o.width, H = o.height;
  const { frames, transitions, labels, hook, timings: t, look } = o.sequence;
  const n = frames.length;
  const FLASH = look.flash;
  const rtl = look.direction === "rtl";

  // When each frame arrives and how long it is held.
  const arrive: number[] = [0], done: number[] = [];
  let clock = 0;
  for (let k = 0; k < n; k++) {
    const dwell = k === 0 || transitions[k - 1] === "cut" ? t.hold : t.rest;
    clock += dwell;
    done[k] = clock;
    if (k < n - 1) {
      clock += transitions[k] === "wipe" ? t.wipe : 0;
      arrive[k + 1] = clock;
    }
  }
  const ctaAt = clock, total = +(clock + t.cta).toFixed(3);

  const hookLayers: Layer[] = hook ? await pill(hook, { cx: W / 2, cy: Math.round(H * look.hookAt), size: Math.round(W * 0.05 * look.hookScale), maxWidth: Math.round(W * 0.82) }) : [];
  const card = t.cta > 0 ? await ctaLayers({ width: W, height: H, product: o.product, filterLabel: o.ctaLabel }) : [];
  const knob = 84, lineW = 6;
  const handle = await sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${knob}" height="${H}"><rect x="${(knob - lineW) / 2}" width="${lineW}" height="${H}" fill="#fff"/><circle cx="${knob / 2}" cy="${H / 2}" r="${knob / 2 - 2}" fill="#fff"/><path d="M${knob / 2 - 9} ${H / 2 - 12} l-12 12 l12 12 M${knob / 2 + 9} ${H / 2 - 12} l12 12 l-12 12" fill="none" stroke="#000" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  )).png().toBuffer();

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "factory-"));
  try {
    const file = (name: string) => path.join(dir, name);
    const inputs: string[] = [];
    let count = 0;
    const add = async (name: string, data: Buffer) => {
      await fs.writeFile(file(name), data);
      inputs.push("-loop", "1", "-framerate", "30", "-t", String(total), "-i", file(name));
      return count++;
    };
    const frameIn: number[] = [];
    for (const [k, f] of frames.entries()) frameIn.push(await add(`f${k}.jpg`, f));
    const hookIn = hookLayers.length ? await add("hook.png", await overlay(W, H, hookLayers)) : -1;
    const cardIn = card.length ? await add("card.png", await overlay(W, H, card)) : -1;
    const labelIn: number[] = [];
    for (const [k, text] of labels.entries()) {
      labelIn[k] = text ? await add(`l${k}.png`, await overlay(W, H, await pill(text, { cx: W / 2, cy: Math.round(H * 0.74), size: Math.round(W * 0.04), maxWidth: Math.round(W * 0.8), weight: "SemiBold" }))) : -1;
    }

    const graph: string[] = [];
    let cur = `[${frameIn[0]}:v]`;
    for (let k = 1; k < n; k++) {
      const kind = transitions[k - 1];
      const at = done[k - 1];
      // Progress of this frame's arrival: an eased line for a wipe, a step for a cut or a flash.
      const p = kind !== "wipe" ? `gte(t,${at})` : look.eased ? `st(0,clip((t-${at})/${t.wipe},0,1));ld(0)*ld(0)*(3-2*ld(0))` : `clip((t-${at})/${t.wipe},0,1)`;
      graph.push(
        // A mask that is white behind the line: this frame shows there, what came before ahead of it.
        `color=white:s=${W}x${H}:r=30:d=${total}[mw${k}]`,
        `color=black:s=${W}x${H}:r=30:d=${total}[mb${k}]`,
        `[mw${k}][mb${k}]overlay=x='${rtl ? "-" : ""}(${p})*${W}':y=0:eval=frame,format=gray[m${k}]`,
        `[${frameIn[k]}:v]format=rgba[fr${k}]`,
        `[fr${k}][m${k}]alphamerge[fm${k}]`,
        `${cur}[fm${k}]overlay=0:0[s${k}]`,
      );
      cur = `[s${k}]`;
      if (kind === "wipe" && look.handle) {
        // Each wipe draws its own copy of the handle.
        const handleIn = await add(`h${k}.png`, handle);
        graph.push(`[${handleIn}:v]format=rgba[h${k}]`, `${cur}[h${k}]overlay=x='${rtl ? `(1-(${p}))` : `(${p})`}*${W}-${knob / 2}':y=0:eval=frame:enable='between(t,${at},${at + t.wipe})'[sh${k}]`);
        cur = `[sh${k}]`;
      }
      if (kind === "flash") {
        graph.push(`color=white:s=${W}x${H}:r=30:d=${total},format=rgba,fade=t=in:st=${(at - 0.07).toFixed(2)}:d=0.07:alpha=1,fade=t=out:st=${at.toFixed(2)}:d=${FLASH}:alpha=1[fl${k}]`, `${cur}[fl${k}]overlay=0:0[sf${k}]`);
        cur = `[sf${k}]`;
      }
    }
    // The hook stays over the first frame and leaves as the first change begins.
    if (hookIn >= 0) {
      graph.push(`[${hookIn}:v]format=rgba,fade=t=out:st=${Math.max(0, done[0] + (transitions[0] === "wipe" ? t.wipe * 0.35 : -0.05)).toFixed(2)}:d=0.25:alpha=1[hk]`, `${cur}[hk]overlay=0:0[shk]`);
      cur = "[shk]";
    }
    // Each name fades in once its frame has arrived and out before the next change (or the closing card).
    for (let k = 0; k < n; k++) {
      if (labelIn[k] < 0) continue;
      const out = (k < n - 1 ? done[k] : t.cta > 0 ? ctaAt : total + 1) - 0.1;
      graph.push(`[${labelIn[k]}:v]format=rgba,fade=t=in:st=${(arrive[k] + 0.05).toFixed(2)}:d=0.25:alpha=1,fade=t=out:st=${out.toFixed(2)}:d=0.2:alpha=1[lb${k}]`, `${cur}[lb${k}]overlay=0:0[sl${k}]`);
      cur = `[sl${k}]`;
    }
    if (cardIn >= 0) {
      graph.push(`[${cardIn}:v]format=rgba,fade=t=in:st=${ctaAt.toFixed(2)}:d=0.25:alpha=1[cd]`, `${cur}[cd]overlay=0:0[scd]`);
      cur = "[scd]";
    }
    graph.push(`${cur}format=yuv420p[out]`);

    const args = [
      "-y", "-hide_banner", "-loglevel", "error", ...inputs,
      "-f", "lavfi", "-t", String(total), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex", graph.join(";"), "-map", "[out]", "-map", `${count}:a`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-maxrate", "4M", "-bufsize", "8M", "-r", "30", "-c:a", "aac", "-b:a", "64k",
      "-movflags", "+faststart", "-t", String(total), file("out.mp4"),
    ];
    await run(await ffmpeg(), args, { maxBuffer: 16 * 1024 * 1024 }).catch((e: { stderr?: string; message: string }) => {
      throw new Error(`The video could not be made: ${(e.stderr || e.message).trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
    });

    const base = o.base;
    const key = `${base}/video.mp4`;
    await put(key, await fs.readFile(file("out.mp4")));

    // Three stills of it for the queue: the opening, a change half way, the end.
    const half = Math.round(W / 2);
    const mid = Math.min(n - 1, Math.max(1, Math.round((n - 1) / 2)));
    const arrived = await sharp(frames[mid]).extract({ left: rtl ? half : 0, top: 0, width: W - half, height: H }).toBuffer();
    const stills: [string, Buffer][] = [
      ["opening", await canvas(W, H, [{ input: frames[0], left: 0, top: 0 }, ...hookLayers])],
      ["change", await canvas(W, H, [{ input: frames[mid - 1], left: 0, top: 0 }, { input: arrived, left: rtl ? half : 0, top: 0 }, ...(look.handle ? [{ input: handle, left: half - knob / 2, top: 0 }] : [])])],
      ["closing", await canvas(W, H, [{ input: frames[n - 1], left: 0, top: 0 }, ...card])],
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
