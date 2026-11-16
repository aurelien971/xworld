import path from "node:path";
import { get, tag, TYPES } from "@/factory/storage";

/** The factory's media by key. The browser keeps a copy and asks whether it changed, so a remade slide shows at once. */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const type = TYPES[path.extname(key.at(-1) ?? "").toLowerCase()];
  if (!type) return new Response("Not found", { status: 404 });
  try {
    const etag = await tag(key.join("/"));
    const headers: Record<string, string> = { "Content-Type": type, "Cache-Control": etag ? "private, no-cache" : "private, max-age=60", "Accept-Ranges": "bytes" };
    if (etag) headers.ETag = etag;
    if (etag && req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    const data = await get(key.join("/"));
    // A video is asked for in ranges (Safari will not play one otherwise).
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, data.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      if (start > end || start >= data.length) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${data.length}` } });
      return new Response(new Uint8Array(data.subarray(start, end + 1)), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${data.length}`, "Content-Length": String(end - start + 1) } });
    }
    return new Response(new Uint8Array(data), { headers: { ...headers, "Content-Length": String(data.length) } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
