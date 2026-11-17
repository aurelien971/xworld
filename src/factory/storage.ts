import fs from "node:fs/promises";
import path from "node:path";
import { MEDIA } from "./paths";

/**
 * Media by key, in one of two places. With a database address set (the
 * deployed factory, or this Mac pointed at it) media lives in the Vercel
 * Blob store; otherwise on disk under /data/media. Either way it is read
 * back through /media/<key>, behind the password.
 */
export const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4" };
const typeOf = (key: string) => TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream";
const token = () => process.env.BLOB_READ_WRITE_TOKEN?.trim();
export const cloud = () => !!process.env.DATABASE_URL && !!token();

/** The store's public address, which is its id from the token. */
const blobUrl = (key: string) => `https://${token()!.split("_")[3].toLowerCase()}.public.blob.vercel-storage.com/${key.split("/").map(encodeURIComponent).join("/")}`;

const safe = (key: string) => {
  const full = path.resolve(MEDIA, key);
  if (!full.startsWith(path.resolve(MEDIA) + path.sep)) throw new Error("Bad media key");
  return full;
};

export async function put(key: string, data: Buffer) {
  if (cloud()) {
    const { put: upload } = await import("@vercel/blob");
    await upload(key, data, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: typeOf(key), cacheControlMaxAge: 60 });
    return key;
  }
  const file = safe(key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  return key;
}

/** Files that are no longer wanted. One that is already gone is not a fault. */
export async function drop(keys: string[]) {
  if (!keys.length) return;
  if (cloud()) {
    const { del } = await import("@vercel/blob");
    await del(keys.map(blobUrl), { token: token() }).catch(() => {});
    return;
  }
  for (const key of keys) await fs.unlink(safe(key)).catch(() => {});
}

export async function get(key: string): Promise<Buffer> {
  if (cloud()) {
    const res = await fetch(blobUrl(key), { cache: "no-store" });
    if (!res.ok) throw new Error(`No media at ${key}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFile(safe(key));
}

/** A short tag that changes when the file does, so a browser can keep a copy and still notice a remake. Local disk only. */
export const tag = async (key: string) => {
  if (cloud()) return null;
  const s = await fs.stat(safe(key));
  return `"${s.size.toString(36)}-${Math.round(s.mtimeMs).toString(36)}"`;
};

/**
 * An address on the open web for one file, for a platform that fetches media itself
 * (Instagram). The file is copied to the Blob store under a name that cannot be guessed.
 */
export async function publicUrl(key: string, data: Buffer) {
  if (!token()) throw new Error("Posting to Instagram needs the media store (BLOB_READ_WRITE_TOKEN): Instagram fetches each file from the web.");
  const { put: upload } = await import("@vercel/blob");
  const { url } = await upload(`out/${key}`, data, { access: "public", addRandomSuffix: true, contentType: typeOf(key) });
  return url;
}

export const mediaUrl = (key: string) => `/media/${key}`;
export const contentType = typeOf;
