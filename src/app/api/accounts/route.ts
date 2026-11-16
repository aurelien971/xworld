import { liveAccounts } from "@/factory/accounts";
import { disconnect, setPosting } from "@/factory/connections";
import { NAMES, type Provider } from "@/factory/platforms";
import * as registry from "@/factory/registry";

export const dynamic = "force-dynamic";
const ID = /^[\w-]{1,80}$/;
const fail = (e: unknown, status = 500) => Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status });

export type AccountsView = {
  personas: {
    id: string; name: string; stance: string; voice: string;
    kit: { idea: string; handles: string[]; bio: string; picture: string; pillars: string[]; first: string[] } | null;
    slots: { id: string; platform: string; platformName: string; handle: string; perDay: number; connected: boolean; needsReconnect: boolean; posting: boolean; offered: boolean }[];
    formats: number;
  }[];
};

async function view(product: string): Promise<AccountsView> {
  const accounts = await liveAccounts();
  return {
    personas: registry.personas().filter((p) => p.product === product).sort((a, b) => Number(b.stance === "official") - Number(a.stance === "official")).map((p) => ({
      id: p.id, name: p.name, stance: p.stance, voice: p.voice, kit: p.kit ?? null,
      slots: accounts.filter((a) => a.persona === p.id).map((a) => ({ id: a.id, platform: a.platform, platformName: NAMES[a.platform as Provider], handle: a.handle, perDay: a.perDay, connected: a.connected, needsReconnect: a.needsReconnect, posting: a.posting, offered: a.offered })),
      formats: registry.formatsFor(p).length,
    })),
  };
}

export async function GET(req: Request) {
  const product = new URL(req.url).searchParams.get("product") || "opaque";
  if (!ID.test(product)) return fail(new Error("Unknown product."), 400);
  try {
    return Response.json(await view(product));
  } catch (e) {
    return fail(e);
  }
}

/** posting: let the factory post to a connected account, or stop it. disconnect: forget the account's sign-in. */
export async function POST(req: Request) {
  const product = new URL(req.url).searchParams.get("product") || "opaque";
  const body = (await req.json().catch(() => ({}))) as { action?: string; account?: string; on?: boolean };
  if (!ID.test(product) || !registry.accounts().some((a) => a.id === body.account)) return fail(new Error("Unknown account."), 400);
  try {
    if (body.action === "posting" && typeof body.on === "boolean") await setPosting(body.account!, body.on);
    else if (body.action === "disconnect") await disconnect(body.account!);
    else return fail(new Error("Unknown request."), 400);
    return Response.json(await view(product));
  } catch (e) {
    return fail(e);
  }
}
