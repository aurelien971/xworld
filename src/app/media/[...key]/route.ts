import path from "node:path";
import { get, tag, TYPES } from "@/factory/storage";

/** The factory's media by key. The browser keeps a copy and asks whether it changed, so a remade slide shows at once. */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const type = TYPES[path.extname(key.at(-1) ?? "").toLowerCase()];
  if (!type) return new Response("Not found", { status: 404 });
  try {
    const etag = await tag(key.join("/"));
    const headers = { "Content-Type": type, "Cache-Control": "private, no-cache", ETag: etag };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(await get(key.join("/"))), { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
