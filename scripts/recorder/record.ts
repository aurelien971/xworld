/**
 * Records the real Opaque app applying one filter to one photo: the robot
 * user opens the app, finds the filter, uploads the photo, plays Pong while
 * it "generates", and reveals the result. Any pair the factory has already
 * generated is recorded at no cost; with --generate, a pair that does not
 * exist yet is made first (one image).
 *
 *   npm run record -- --brief opaque-2026-11-19-12
 *   npm run record -- --asset <id> --filter film_authentic --variation vintage
 *   npm run record -- --asset <id> --filter black --variation soft --generate
 *
 * Options: --category "Style" (the tile the filter sits under, when it is not
 * simply the filter's category), --rally 7 (seconds of Pong), --wait 11
 * (seconds the app takes to "generate"), --app <Opaque.app> (install this
 * build first), --keep (keep the untrimmed take).
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

for (const line of fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8").split("\n") : []) {
  const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const has = (name: string) => process.argv.includes(`--${name}`);
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const title = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

async function main() {
  const registry = await import("../../src/factory/registry");
  const { sql, closeDb } = await import("../../src/factory/db");
  const { get, put } = await import("../../src/factory/storage");
  const { generationKey } = await import("../../src/factory/stages/transform");
  const { DATA } = await import("../../src/factory/paths");

  // Which pair.
  let product = arg("product") ?? "opaque", asset = arg("asset"), filterId = arg("filter"), variationId = arg("variation");
  if (arg("brief")) {
    const [b] = await sql<{ product: string; inputs: { asset: string; filter: string; variation: string } }>("select product, inputs from briefs where id = $1", [arg("brief")]);
    if (!b) throw new Error(`There is no post "${arg("brief")}".`);
    ({ product } = b);
    ({ asset, filter: filterId, variation: variationId } = b.inputs);
  }
  if (!asset || !filterId) throw new Error("Say which pair: --brief <post id>, or --asset <photo id> --filter <filter id> [--variation <id>].");
  const filter = registry.filter(product, filterId);
  const variation = variationId ? filter.variations.find((v) => v.id === variationId) : filter.variations[0];
  if (!variation) throw new Error(`The filter "${filter.name}" has no variation "${variationId}".`);
  const [photo] = await sql<{ media_key: string }>("select media_key from assets where id = $1", [asset]);
  if (!photo) throw new Error("That photo is not in the library.");
  const [made] = await sql<{ media_key: string }>("select media_key from generations where key = $1", [generationKey(asset, filter.id, variation.id, variation.prompt)]);
  let afterKey = made?.media_key;
  if (!afterKey) {
    // Not made yet: make it now, once. It is kept, so every later post and recording of this pair is free.
    if (!has("generate")) throw new Error(`This photo has not been through ${filter.name} · ${variation.label} yet. Add --generate to make it now (it costs one image).`);
    const { transform } = await import("../../src/factory/stages/transform");
    const g = await transform({ asset, assetKey: photo.media_key, filter: filter.id, variation: variation.id, prompt: variation.prompt, quality: filter.quality });
    console.log(`Generated ${filter.name} · ${variation.label}${g.costUsd ? ` for $${g.costUsd.toFixed(3)}` : ""}`);
    afterKey = g.mediaKey;
  }

  const slug = `${asset.slice(0, 8).toLowerCase()}_${filter.id}_${variation.id}`;
  const root = path.join(DATA, "recordings");
  const dir = path.join(root, slug), marks = path.join(dir, "marks");
  fs.rmSync(marks, { recursive: true, force: true });
  fs.mkdirSync(marks, { recursive: true });
  // Written fresh, so it is the newest photo in the simulator's library and so the first in the picker.
  fs.writeFileSync(path.join(dir, "before.jpg"), await get(photo.media_key));
  fs.writeFileSync(path.join(dir, "after.jpg"), await get(afterKey));
  await closeDb();

  // The simulator.
  if (!fs.existsSync(path.join(root, "device"))) throw new Error("There is no recorder simulator yet. See scripts/recorder/README.md.");
  const device = fs.readFileSync(path.join(root, "device"), "utf8").trim();
  sh("xcrun", ["simctl", "bootstatus", device, "-b"]);
  sh("xcrun", ["simctl", "status_bar", device, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--cellularBars", "4", "--wifiBars", "3"]);
  if (arg("app")) sh("xcrun", ["simctl", "install", device, arg("app")!]);
  // The picker shows the simulator's photo library newest first, and the robot picks the first photo.
  // So this photo must be the last one added, and no photo should be in there twice.
  const shelf = path.join(root, "library.json");
  const added: { asset: string; file: string }[] = fs.existsSync(shelf) ? JSON.parse(fs.readFileSync(shelf, "utf8")) : [];
  const mine = { asset, file: path.join(dir, "before.jpg") };
  if (added.at(-1)?.asset !== asset) {
    let others = added.filter((a) => a.asset !== asset && fs.existsSync(a.file));
    if (!fs.existsSync(shelf) || added.some((a) => a.asset === asset)) {
      // Start the library again: empty it, then put back the other photos, and this one last.
      const media = path.join(process.env.HOME!, "Library/Developer/CoreSimulator/Devices", device, "data/Media");
      sh("xcrun", ["simctl", "shutdown", device]);
      for (const d of ["DCIM", "PhotoData"]) fs.rmSync(path.join(media, d), { recursive: true, force: true });
      sh("xcrun", ["simctl", "bootstatus", device, "-b"]);
      sh("xcrun", ["simctl", "status_bar", device, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--cellularBars", "4", "--wifiBars", "3"]);
      if (!others.length) {
        // Nothing to put back yet: a few photos from the library, so the picker is not a single picture.
        const photos = path.join(DATA, "media", "photos");
        const names = fs.existsSync(photos) ? fs.readdirSync(photos).filter((f) => f.endsWith(".jpg") && !f.startsWith(asset!)).slice(0, 8) : [];
        others = names.map((f) => ({ asset: f.replace(/\.jpg$/, ""), file: path.join(photos, f) }));
      }
      for (const o of others.slice(-11)) sh("xcrun", ["simctl", "addmedia", device, o.file]);
      await sleep(1500);
    }
    sh("xcrun", ["simctl", "addmedia", device, mine.file]);
    fs.writeFileSync(shelf, JSON.stringify([...others.slice(-11), mine], null, 2));
    await sleep(1500);
  }

  // The robot user, built once.
  const project = path.join("scripts", "recorder", "robot", "Robot.xcodeproj");
  const derived = path.join(root, "robot-dd");
  const base = ["-project", project, "-scheme", "Robot", "-destination", `id=${device}`, "-derivedDataPath", derived];
  if (!fs.existsSync(path.join(derived, "Build", "Products")) || has("rebuild")) sh("xcodebuild", ["build-for-testing", ...base]);

  const labels = { CATEGORY: arg("category") ?? title(filter.category), FILTER: filter.name, VARIATION: variation.label };
  console.log(`Recording ${labels.CATEGORY} › ${labels.FILTER} › ${labels.VARIATION}`);
  const run = spawn("xcodebuild", ["test-without-building", ...base], {
    env: { ...process.env, ...Object.fromEntries(Object.entries({ ...labels, RESULT: path.join(dir, "after.jpg"), WAIT: arg("wait") ?? "11", RALLY: arg("rally") ?? "7", MARKS: marks }).map(([k, v]) => [`TEST_RUNNER_${k}`, v])) },
  });
  let out = "";
  run.stdout.on("data", (d) => (out += d));
  run.stderr.on("data", (d) => (out += d));
  const finished = new Promise<number>((resolve) => run.on("close", (code) => resolve(code ?? 1)));

  // The recording starts when the robot says it is about to open the app, and stops when it is done.
  const raw = path.join(dir, "take.mp4");
  let recorder: ReturnType<typeof spawn> | null = null;
  let code: number | null = null;
  finished.then((c) => (code = c));
  while (code === null && !fs.existsSync(path.join(marks, "done"))) {
    if (!recorder && fs.existsSync(path.join(marks, "start"))) recorder = spawn("xcrun", ["simctl", "io", device, "recordVideo", "--codec", "h264", "--force", raw], { stdio: "ignore" });
    await sleep(150);
  }
  if (recorder) {
    const closed = new Promise((r) => recorder!.on("close", r));
    recorder.kill("SIGINT");
    await closed;
  }
  code = await finished;
  if (code !== 0 || !fs.existsSync(path.join(marks, "done"))) {
    const why = out.split("\n").filter((l) => /error:|XCTAssert|failed/i.test(l)).slice(0, 6).join("\n");
    throw new Error(`The robot could not finish.\n${why || out.slice(-600)}`);
  }

  const cut = path.join(dir, "app.mp4");
  console.log(sh("node", [path.join("scripts", "recorder", "tighten.mjs"), raw, cut, arg("beat") ?? "1.1"]));
  if (!has("keep")) fs.rmSync(raw, { force: true });
  await put(`recordings/${slug}.mp4`, fs.readFileSync(cut));
  console.log(`${cut}\n/media/recordings/${slug}.mp4`);
}

main().then(() => process.exit(0), (e) => {
  console.error(e.message);
  process.exit(1);
});
