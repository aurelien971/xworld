import fs from "node:fs/promises";
import path from "node:path";
import { MEDIA } from "./paths";

/**
 * Media by key. Local disk for now (/data/media, served at /media/<key>);
 * a bucket takes the same three calls when the factory moves off this Mac.
 */
const safe = (key: string) => {
  const full = path.resolve(MEDIA, key);
  if (!full.startsWith(path.resolve(MEDIA) + path.sep)) throw new Error("Bad media key");
  return full;
};

export async function put(key: string, data: Buffer) {
  const file = safe(key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  return key;
}

export const get = (key: string) => fs.readFile(safe(key));
/** A short tag that changes when the file does, so a browser can keep a copy and still notice a remake. */
export const tag = async (key: string) => {
  const s = await fs.stat(safe(key));
  return `"${s.size.toString(36)}-${Math.round(s.mtimeMs).toString(36)}"`;
};
export const has = (key: string) => fs.access(safe(key)).then(() => true, () => false);
export const mediaUrl = (key: string) => `/media/${key}`;
export const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4" };
