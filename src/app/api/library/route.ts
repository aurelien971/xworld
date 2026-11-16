import { libraryView } from "@/factory/campaign";
import { sql } from "@/factory/db";

export const dynamic = "force-dynamic";
const ok = (product: string) => /^[a-z0-9-]{1,40}$/.test(product);
const fail = (e: unknown, status = 500) => Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status });

export async function GET(req: Request) {
  const product = new URL(req.url).searchParams.get("product") || "opaque";
  if (!ok(product)) return fail(new Error("Unknown product."), 400);
  try {
    return Response.json(await libraryView(product));
  } catch (e) {
    return fail(e);
  }
}

/** Approve a source photo for use in posts, or take it out. */
export async function POST(req: Request) {
  const product = new URL(req.url).searchParams.get("product") || "opaque";
  const body = (await req.json().catch(() => ({}))) as { id?: string; approved?: boolean };
  if (!ok(product) || typeof body.approved !== "boolean" || typeof body.id !== "string") return fail(new Error("Unknown request."), 400);
  try {
    await sql("update assets set approved = $2 where id = $1 and product = $3 and kind = 'photo'", [body.id, body.approved, product]);
    return Response.json(await libraryView(product));
  } catch (e) {
    return fail(e);
  }
}
