import crypto from "node:crypto";
import { callbackFor, sign } from "@/factory/connections";
import { authorizeUrl, available, type Provider } from "@/factory/platforms";
import * as registry from "@/factory/registry";

export const dynamic = "force-dynamic";

/** Begins connecting an account to a slot: sends the person to the platform's own sign-in. */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const provider = (await ctx.params).provider as Provider;
  const account = registry.accounts().find((a) => a.id === new URL(req.url).searchParams.get("account"));
  if (!account || account.platform !== provider) return new Response("Unknown account.", { status: 404 });
  const persona = registry.persona(account.persona);
  const back = new URL(`/${persona.product}?view=accounts`, req.url);
  try {
    if (!available(provider)) throw new Error("This platform has no developer keys yet.");
    // PKCE: the verifier stays in a cookie on this browser; only its digest goes to the platform.
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = sign({ account: account.id, provider }, 900);
    return new Response(null, {
      status: 302,
      headers: { Location: authorizeUrl(provider, callbackFor(req, provider), state, challenge), "Set-Cookie": `factory_pkce=${verifier}; Path=/api/connect; HttpOnly; SameSite=Lax; Max-Age=900` },
    });
  } catch (e) {
    back.searchParams.set("connect-error", (e as Error).message.slice(0, 200));
    return Response.redirect(back, 302);
  }
}
