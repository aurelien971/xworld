import { filtersView } from "@/factory/campaign";
import { sql } from "@/factory/db";
import * as registry from "@/factory/registry";

export const dynamic = "force-dynamic";
const ok = (product: string) => /^[a-z0-9-]{1,40}$/.test(product);
const fail = (e: unknown, status = 500) => Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status });

export async function GET(req: Request) {
  const product = new URL(req.url).searchParams.get("product") || "opaque";
  if (!ok(product)) return fail(new Error("Unknown product."), 400);
  try {
    return Response.json(await filtersView(product));
  } catch (e) {
    return fail(e);
  }
}

/** Let a filter into the plan, or take it out. */
export async function POST(req: Request) {
  const product = new URL(req.url).searchParams.get("product") || "opaque";
  const body = (await req.json().catch(() => ({}))) as { id?: string; approved?: boolean };
  if (!ok(product) || typeof body.approved !== "boolean" || !registry.filters(product).some((f) => f.id === body.id)) return fail(new Error("Unknown request."), 400);
  try {
    await sql("insert into filter_state (id, approved) values ($1,$2) on conflict (id) do update set approved = excluded.approved, at = now()", [body.id, body.approved]);
    return Response.json(await filtersView(product));
  } catch (e) {
    return fail(e);
  }
}
