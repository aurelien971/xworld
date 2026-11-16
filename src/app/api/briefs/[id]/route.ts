import { after } from "next/server";
import { brief } from "@/factory/briefs";
import { reviewBrief, runDay } from "@/factory/pipeline";
import { briefDetail } from "@/factory/view";

export const dynamic = "force-dynamic";
const ID = /^[a-z0-9-]{4,80}$/;
const fail = (message: string, status: number) => Response.json({ error: message }, { status });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return fail("Unknown brief.", 404);
  const detail = await briefDetail(id);
  return detail ? Response.json(detail) : fail("Unknown brief.", 404);
}

/** approve / reject: a person's review. retry: run a failed brief again. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const b = ID.test(id) ? await brief(id) : null;
  if (!b) return fail("Unknown brief.", 404);
  if (action === "approve" || action === "reject") {
    if (!(await reviewBrief(id, action === "approve"))) return fail("This brief can't be reviewed now.", 409);
  } else if (action === "retry") {
    if (b.state !== "failed") return fail("Only a failed brief can be run again.", 409);
    after(() => runDay(b.product, b.day, [id]).catch(() => {}));
  } else return fail("Unknown request.", 400);
  return Response.json(await briefDetail(id));
}
