import { callbackFor, connect, verify } from "@/factory/connections";
import { exchange, profile, type Provider } from "@/factory/platforms";
import * as registry from "@/factory/registry";

export const dynamic = "force-dynamic";

/**
 * The platform sends the person back here. The code becomes a sign-in,
 * which is sealed and kept against the account slot it was started for;
 * the person lands back on the accounts. Posting stays off until it is
 * switched on there.
 */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const url = new URL(req.url);
  const provider = (await ctx.params).provider as Provider;
  let product = "opaque";
  const back = (q: Record<string, string>) => {
    const to = new URL(`/${product}?view=accounts`, req.url);
    for (const [k, v] of Object.entries(q)) to.searchParams.set(k, v);
    return new Response(null, { status: 302, headers: { Location: to.toString(), "Set-Cookie": "factory_pkce=; Path=/api/connect; HttpOnly; Max-Age=0" } });
  };
  try {
    const st = verify<{ account: string; provider: Provider }>(url.searchParams.get("state") ?? "");
    const account = registry.accounts().find((a) => a.id === st.account);
    if (!account || st.provider !== provider) throw new Error("This sign-in was for another account.");
    product = registry.persona(account.persona).product;
    const denied = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (denied) throw new Error(denied === "access_denied" ? "The connection was cancelled." : denied);
    const verifier = /(?:^|;\s*)factory_pkce=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1] ?? "";
    const tokens = await exchange(provider, url.searchParams.get("code") ?? "", callbackFor(req, provider), verifier);
    const who = await profile(provider, tokens);
    await connect(account.id, provider, tokens, who);
    return back({ connected: `${provider}:${who.username}` });
  } catch (e) {
    return back({ "connect-error": (e as Error).message.slice(0, 200) });
  }
}
