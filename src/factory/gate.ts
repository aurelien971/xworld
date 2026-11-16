/**
 * The password gate. One shared password (FACTORY_PASSWORD); the cookie
 * holds a keyed digest of it, never the password. With no password set the
 * factory is open on a laptop and closed on a deployment.
 */
export const COOKIE = "factory";
const enc = new TextEncoder();

export async function sessionFor(password: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("factory-session-v1"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const password = () => process.env.FACTORY_PASSWORD || "";
/** Open with no password at all: only off a deployment. */
export const openToAll = () => !password() && !process.env.VERCEL;

export async function allowed(cookie: string | undefined) {
  if (openToAll()) return true;
  const p = password();
  return !!p && !!cookie && cookie === (await sessionFor(p));
}
