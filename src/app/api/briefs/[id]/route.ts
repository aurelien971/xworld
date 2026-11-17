import { after } from "next/server";
import { brief } from "@/factory/briefs";
import { remake, remakeLater, reviewBrief, runDay } from "@/factory/pipeline";
import { tune, type Scope } from "@/factory/tuning";
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

/** approve / reject: a person's review. retry: run a failed brief again. tune: set the format's dials for this post, its format or everything, and make what changed again. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { action, scope, changes } = (await req.json().catch(() => ({}))) as { action?: string; scope?: Scope; changes?: Record<string, unknown> };
  const b = ID.test(id) ? await brief(id) : null;
  if (!b) return fail("Unknown brief.", 404);
  if (action === "approve" || action === "reject") {
    if (!(await reviewBrief(id, action === "approve"))) return fail("This brief can't be reviewed now.", 409);
  } else if (action === "retry") {
    if (b.state !== "failed") return fail("Only a failed brief can be run again.", 409);
    after(() => runDay(b.product, b.day, [id]).catch(() => {}));
  } else if (action === "tune") {
    if (!b.slides.length || b.publish || b.state === "published") return fail("A post that is out can't be changed.", 409);
    if (!changes || !["post", "format", "all"].includes(scope ?? "")) return fail("Unknown request.", 400);
    try {
      const rest = (await tune({ scope: scope!, brief: id, format: b.format }, changes)).filter((x) => x !== id);
      // This post first, so the answer shows it; the others behind it.
      await remake(id, "Made again with new settings");
      if (rest.length) after(() => remakeLater(rest, "Made again with new settings"));
      return Response.json({ ...(await briefDetail(id)), remaking: rest.length });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "That didn't work.", 400);
    }
  } else return fail("Unknown request.", 400);
  return Response.json(await briefDetail(id));
}
