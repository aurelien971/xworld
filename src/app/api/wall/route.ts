import { remakeAll } from "@/factory/pipeline";
import { wallView } from "@/factory/view";

export const dynamic = "force-dynamic";

/** Everything a product has made, for the wall. */
export async function GET(req: Request) {
  const product = new URL(req.url).searchParams.get("product") || "opaque";
  if (!/^[a-z0-9-]{1,40}$/.test(product)) return Response.json({ error: "Unknown product." }, { status: 400 });
  try {
    return Response.json(await wallView(product));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}

/** remake: every post that is not out yet gets its slides made again from the current scenes. Costs nothing. */
export async function POST(req: Request) {
  const product = new URL(req.url).searchParams.get("product") || "opaque";
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (!/^[a-z0-9-]{1,40}$/.test(product) || action !== "remake") return Response.json({ error: "Unknown request." }, { status: 400 });
  try {
    const remade = await remakeAll(product);
    return Response.json({ remade, ...(await wallView(product)) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
