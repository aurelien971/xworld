import { campaignView } from "@/factory/campaign";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const product = new URL(req.url).searchParams.get("product") || "opaque";
  if (!/^[a-z0-9-]{1,40}$/.test(product)) return Response.json({ error: "Unknown product." }, { status: 400 });
  try {
    return Response.json(await campaignView(product));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
