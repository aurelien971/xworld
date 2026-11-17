/**
 * Tightens a screen recording: every stretch where nothing moves is cut down
 * to a short beat, so the clip is all action. Then it is fitted to a vertical
 * 1080×1920 frame at 30 fps with a silent track, ready to post or to place in
 * a composition.
 *
 *   node scripts/recorder/tighten.mjs <in.mp4> <out.mp4> [beat seconds = 0.9] [speed = 1]
 */
import { execFileSync, spawnSync } from "node:child_process";

const [input, output, beatArg, speedArg] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: tighten.mjs <in.mp4> <out.mp4> [beat] [speed]");
const beat = Number(beatArg ?? 0.9), speed = Number(speedArg ?? 1);

const total = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input]).toString());
const log = spawnSync("ffmpeg", ["-hide_banner", "-i", input, "-vf", "scale=300:-1,freezedetect=n=0.0008:d=0.7", "-an", "-f", "null", "-"]).stderr.toString();
const starts = [...log.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
const ends = [...log.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));

// Still stretches, with ones that touch joined into one.
const still = [];
for (const [i, s] of starts.entries()) {
  const e = ends[i] ?? total;
  const last = still.at(-1);
  if (last && s - last[1] < 0.15) last[1] = e;
  else still.push([s, e]);
}
// What is kept: everything, less each still stretch beyond its first beat.
const keep = [];
let at = 0;
for (const [s, e] of still) {
  if (e - s <= beat) continue;
  keep.push([at, s + beat]);
  at = e;
}
if (total - at > 0.05) keep.push([at, total]);

const parts = keep.map(([a, b], i) => `[0:v]trim=${a.toFixed(3)}:${b.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
const graph = [
  ...parts,
  `${keep.map((_, i) => `[v${i}]`).join("")}concat=n=${keep.length}:v=1:a=0,setpts=PTS/${speed},fps=30,scale=-2:1920,pad=1080:1920:(ow-iw)/2:0:black,format=yuv420p[out]`,
].join(";");
execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-filter_complex", graph, "-map", "[out]", "-map", "1:a", "-shortest", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", output]);
const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", output]).toString());
console.log(`${total.toFixed(1)}s → ${seconds.toFixed(1)}s in ${keep.length} parts`);
