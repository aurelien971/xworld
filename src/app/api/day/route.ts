import { after } from "next/server";
import { runDay } from "@/factory/pipeline";
import { planDay } from "@/factory/planner";
import { dayOf, isDay } from "@/factory/time";
import { dayView } from "@/factory/view";

export const dynamic = "force-dynamic";
const PRODUCT = /^[a-z0-9-]{1,40}$/;

const read = (url: URL) => {
  const product = url.searchParams.get("product") || "opaque";
  const day = url.searchParams.get("day") || dayOf();
  return PRODUCT.test(product) && isDay(day) ? { product, day } : null;
};
const fail = (e: unknown, status = 500) => Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status });

export async function GET(req: Request) {
  const q = read(new URL(req.url));
  if (!q) return fail(new Error("Unknown product or day."), 400);
  try {
    return Response.json(await dayView(q.product, q.day));
  } catch (e) {
    return fail(e);
  }
}

/** plan: write the day's briefs. run: start every planned brief; the work carries on after the answer. */
export async function POST(req: Request) {
  const q = read(new URL(req.url));
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (!q || (body.action !== "plan" && body.action !== "run")) return fail(new Error("Unknown request."), 400);
  try {
    if (body.action === "plan") await planDay(q.product, q.day);
    else after(() => runDay(q.product, q.day).catch(() => {}));
    return Response.json(await dayView(q.product, q.day));
  } catch (e) {
    return fail(e);
  }
}
