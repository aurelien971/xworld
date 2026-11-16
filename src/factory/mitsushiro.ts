/**
 * The factory's side of Mitsushiro, which holds every account's sign-in and
 * does the posting. Four calls, all with the shared secret: the creators and
 * what each has connected, a new creator, the address to connect an account
 * at, and a finished post. Set MITSUSHIRO_URL and MITSUSHIRO_INGEST_SECRET.
 */
const base = () => process.env.MITSUSHIRO_URL?.replace(/\/$/, "");
const secret = () => process.env.MITSUSHIRO_INGEST_SECRET?.trim();
export const configured = () => !!base() && !!secret();

export type Connection = { provider: string; username?: string; needsReconnect?: boolean };
export type Creator = { id: string; name: string; kind?: string; connections: Connection[] };

async function call<T>(path: string, init: RequestInit = {}, timeout = 60_000): Promise<T> {
  if (!configured()) throw new Error("The publisher is not configured.");
  const res = await fetch(`${base()}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${secret()}` }, signal: AbortSignal.timeout(timeout), cache: "no-store" });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error || (res.status === 404 ? "The publisher did not recognise the factory. Check that its ingest routes are deployed and the secret matches." : `The publisher answered ${res.status}.`));
  return body;
}
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const g = globalThis as unknown as { __creators?: { at: number; list: Creator[] } };
/** Every creator and its connected accounts. Kept for half a minute: the screen asks often. */
export async function creators(fresh = false): Promise<Creator[]> {
  if (!fresh && g.__creators && Date.now() - g.__creators.at < 30_000) return g.__creators.list;
  const { creators: list } = await call<{ creators: Creator[] }>("/api/ingest/creators");
  g.__creators = { at: Date.now(), list };
  return list;
}
export const forget = () => {
  g.__creators = undefined;
};

export const createCreator = (name: string) => call<{ id: string; name: string }>("/api/ingest/creators", json({ name }));
/** The platform's sign-in page for connecting an account to a creator; the person lands on `back` afterwards. */
export const connectUrl = (model: string, provider: string, back: string) => call<{ url: string }>("/api/ingest/connect", json({ model, provider, back }));

export const sendPost = (form: FormData) => call<{ post: string; due?: string }>("/api/ingest/post", { method: "POST", body: form }, 180_000);
export type Standing = { status: "queued" | "sent" | "live" | "failed"; url?: string; error?: string; metrics?: { views?: number; likes?: number; comments?: number; shares?: number } };
export const standingOf = (q: Record<string, string>) => call<Standing>(`/api/ingest/post?${new URLSearchParams(q)}`);
