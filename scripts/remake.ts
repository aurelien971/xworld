/** Makes every post that is not out yet again, from the same pairs and words: after a scene or a format changes. Costs nothing. The dev server must be stopped. */
import { closeDb } from "../src/factory/db";
import { remakeAll } from "../src/factory/pipeline";

remakeAll(process.argv[2] || "opaque").then(async (n) => {
  console.log("made again:", n);
  await closeDb();
});
