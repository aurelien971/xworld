import { link, liveAccounts, unlink } from "@/factory/accounts";
import * as mitsushiro from "@/factory/mitsushiro";
import * as registry from "@/factory/registry";

export const dynamic = "force-dynamic";
const ID = /^[\w-]{1,80}$/;
const fail = (e: unknown, status = 500) => Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status });

export type AccountsView = {
  configured: boolean;
  error: string | null;
  creators: { id: string; name: string }[];
  personas: {
    id: string; name: string; stance: string; voice: string; model: string | null; creatorName: string | null;
    kit: { idea: string; handles: string[]; bio: string; picture: string; pillars: string[]; first: string[] } | null;
    slots: { id: string; platform: string; handle: string; status: string; perDay: number; connected: boolean; needsReconnect: boolean }[];
    formats: string[];
  }[];
};

async function view(product: string): Promise<AccountsView> {
  let error: string | null = null;
  const creators = mitsushiro.configured() ? await mitsushiro.creators().catch((e) => ((error = (e as Error).message), [])) : [];
  const accounts = await liveAccounts();
  return {
    configured: mitsushiro.configured(),
    error,
    creators: creators.map((c) => ({ id: c.id, name: c.name })),
    personas: registry.personas().filter((p) => p.product === product).sort((a, b) => Number(b.stance === "official") - Number(a.stance === "official")).map((p) => {
      const slots = accounts.filter((a) => a.persona === p.id);
      const model = slots[0]?.model ?? null;
      return {
        id: p.id, name: p.name, stance: p.stance, voice: p.voice, kit: p.kit ?? null, model, creatorName: creators.find((c) => c.id === model)?.name ?? null,
        slots: slots.map((a) => ({ id: a.id, platform: a.platform, handle: a.handle, status: a.status, perDay: a.perDay, connected: a.connected, needsReconnect: a.needsReconnect })),
        formats: registry.formatsFor(p).map((f) => f.name),
      };
    }),
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

/**
 * link: tie a persona to an existing Mitsushiro creator. create: make a new creator for it there, and tie them.
 * unlink: untie. connect: the platform's sign-in page for one of the persona's accounts.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const product = url.searchParams.get("product") || "opaque";
  const body = (await req.json().catch(() => ({}))) as { action?: string; persona?: string; model?: string; platform?: string };
  const persona = registry.personas().find((p) => p.id === body.persona && p.product === product);
  if (!ID.test(product) || !persona) return fail(new Error("Unknown persona."), 400);
  try {
    if (body.action === "link") {
      const creator = (await mitsushiro.creators(true)).find((c) => c.id === body.model);
      if (!creator) return fail(new Error("That creator isn't in Mitsushiro."), 400);
      await link(persona.id, creator.id, creator.name);
    } else if (body.action === "create") {
      const made = await mitsushiro.createCreator(`${registry.product(product).name} · ${persona.name}`);
      await link(persona.id, made.id, made.name);
      mitsushiro.forget();
    } else if (body.action === "unlink") {
      await unlink(persona.id);
    } else if (body.action === "connect") {
      const slot = (await liveAccounts()).find((a) => a.persona === persona.id && a.platform === body.platform);
      if (!slot?.model) return fail(new Error("Link this persona to a creator first."), 409);
      const back = `${process.env.FACTORY_ORIGIN?.replace(/\/$/, "") || url.origin}/${product}?view=accounts`;
      mitsushiro.forget();
      return Response.json(await mitsushiro.connectUrl(slot.model, slot.platform, back));
    } else return fail(new Error("Unknown request."), 400);
    return Response.json(await view(product));
  } catch (e) {
    return fail(e);
  }
}
