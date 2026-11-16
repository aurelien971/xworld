import { ideasView } from "@/factory/campaign";
import { sql } from "@/factory/db";
import * as registry from "@/factory/registry";

export const dynamic = "force-dynamic";
const ok = (product: string) => /^[a-z0-9-]{1,40}$/.test(product);
const fail = (e: unknown, status = 500) => Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status });

export async function GET(req: Request) {
  const product = new URL(req.url).searchParams.get("product") || "opaque";
  if (!ok(product)) return fail(new Error("Unknown product."), 400);
  try {
    return Response.json(await ideasView(product));
  } catch (e) {
    return fail(e);
  }
}

/** Approve or reject ideas, or put them back to draft: by id, or every idea of a persona that is still a draft. */
export async function POST(req: Request) {
  const product = new URL(req.url).searchParams.get("product") || "opaque";
  const body = (await req.json().catch(() => ({}))) as { ids?: string[]; persona?: string; state?: string };
  if (!ok(product) || !["approved", "rejected", "draft"].includes(body.state ?? "")) return fail(new Error("Unknown request."), 400);
  try {
    const all = registry.ideas(product);
    const current = new Map((await sql<{ id: string; state: string }>("select id, state from idea_state")).map((r) => [r.id, r.state]));
    const ids = body.ids?.length ? body.ids.filter((id) => all.some((i) => i.id === id)) : all.filter((i) => i.persona === body.persona && (current.get(i.id) ?? "draft") === "draft").map((i) => i.id);
    for (const id of ids.slice(0, 500)) await sql("insert into idea_state (id, state) values ($1,$2) on conflict (id) do update set state = excluded.state, at = now()", [id, body.state]);
    return Response.json(await ideasView(product));
  } catch (e) {
    return fail(e);
  }
}
