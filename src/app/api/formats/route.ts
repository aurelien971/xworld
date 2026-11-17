import { after } from "next/server";
import { remakeLater, remaking } from "@/factory/pipeline";
import * as registry from "@/factory/registry";
import { formatsView, tune } from "@/factory/tuning";

export const dynamic = "force-dynamic";
const ok = (product: string) => /^[a-z0-9-]{1,40}$/.test(product);
const fail = (e: unknown, status = 500) => Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status });

/** Every format as its combination of criteria, with its dials as they stand. */
export async function GET(req: Request) {
  const product = new URL(req.url).searchParams.get("product") || "opaque";
  if (!ok(product)) return fail(new Error("Unknown product."), 400);
  try {
    return Response.json(await formatsView(product, remaking()));
  } catch (e) {
    return fail(e);
  }
}

/** Set a format's dials, for that format or for every format that has them. The posts it changes are made again behind the answer. */
export async function POST(req: Request) {
  const product = new URL(req.url).searchParams.get("product") || "opaque";
  const body = (await req.json().catch(() => ({}))) as { format?: string; scope?: string; changes?: Record<string, unknown> };
  if (!ok(product) || !registry.formats().some((f) => f.id === body.format) || (body.scope !== "format" && body.scope !== "all") || !body.changes) return fail(new Error("Unknown request."), 400);
  try {
    const ids = await tune({ scope: body.scope, format: body.format! }, body.changes);
    const view = await formatsView(product, remaking() + ids.length);
    if (ids.length) after(() => remakeLater(ids, "Made again with new settings"));
    return Response.json(view);
  } catch (e) {
    return fail(e, 400);
  }
}
