import crypto from "node:crypto";
import { sql } from "./db";
import { PlatformError, renewed, type Profile, type Provider, type Tokens } from "./platforms";

/**
 * The accounts' sign-ins, kept by the factory itself. One row per account
 * slot that has a real account behind it: who it is, its sign-in sealed
 * with the factory's own secret (FACTORY_SECRET), and whether the factory
 * may post to it. Connecting an account never switches posting on.
 */
export type Connection = { account: string; provider: Provider; username: string; name: string | null; avatar: string | null; posting: boolean; needsReconnect: boolean; at: string };

/** The address a platform sends the person back to. It must be one registered with that platform's developer app. */
export const callbackFor = (req: Request, provider: string) => `${process.env.FACTORY_ORIGIN?.replace(/\/$/, "") || new URL(req.url).origin}/api/connect/${provider}/callback`;

const secret = () => {
  const s = process.env.FACTORY_SECRET?.trim();
  if (!s || s.length < 32) throw new Error("FACTORY_SECRET is not set (32 characters or more). Accounts cannot be connected without it.");
  return crypto.createHash("sha256").update(s).digest();
};

function seal(value: unknown) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
function unseal<T>(blob: string): T {
  const raw = Buffer.from(blob, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", secret(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as T;
}

/** A short-lived signed note carried through a platform's sign-in and back: which account is being connected. */
export function sign(value: Record<string, unknown>, seconds: number) {
  const body = Buffer.from(JSON.stringify({ ...value, exp: Date.now() + seconds * 1000 })).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", secret()).update(body).digest("base64url")}`;
}
export function verify<T>(token: string): T {
  const [body, mac] = token.split(".");
  const want = crypto.createHmac("sha256", secret()).update(body ?? "").digest("base64url");
  if (!body || !mac || mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) throw new Error("This sign-in could not be verified. Start again.");
  const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
  if (value.exp < Date.now()) throw new Error("This sign-in took too long. Start again.");
  return value;
}

type Row = { account: string; provider: Provider; username: string; name: string | null; avatar: string | null; posting: boolean; needs_reconnect: boolean; at: Date };
const toConnection = (r: Row): Connection => ({ account: r.account, provider: r.provider, username: r.username, name: r.name, avatar: r.avatar, posting: r.posting, needsReconnect: r.needs_reconnect, at: new Date(r.at).toISOString() });

export const connections = async () => (await sql<Row>("select account, provider, username, name, avatar, posting, needs_reconnect, at from connections")).map(toConnection);

/** A new sign-in for an account slot. Signing in again replaces the old one and keeps the posting switch as it was. */
export async function connect(account: string, provider: Provider, tokens: Tokens, who: Profile) {
  await sql(
    `insert into connections (account, provider, username, name, avatar, sealed, needs_reconnect) values ($1,$2,$3,$4,$5,$6,false)
     on conflict (account) do update set provider = excluded.provider, username = excluded.username, name = excluded.name, avatar = excluded.avatar, sealed = excluded.sealed, needs_reconnect = false, at = now()`,
    [account, provider, who.username, who.name ?? null, who.avatar ?? null, seal({ ...tokens, userId: who.userId ?? tokens.userId, username: who.username })],
  );
}
export const disconnect = (account: string) => sql("delete from connections where account = $1", [account]);
export const setPosting = (account: string, on: boolean) => sql("update connections set posting = $2 where account = $1", [account, on]);

const g = globalThis as unknown as { __renewing?: Map<string, Promise<Tokens>> };
const renewing = (g.__renewing ??= new Map());

/**
 * An account's sign-in, renewed first when it is about to run out and saved
 * at once (X's renewal can be used only once, so two renewals never run side
 * by side). A sign-in the platform has refused marks the account as needing
 * to be connected again.
 */
export function tokensFor(account: string): Promise<Tokens> {
  const running = renewing.get(account);
  if (running) return running;
  const job = (async () => {
    const [row] = await sql<{ provider: Provider; sealed: string }>("select provider, sealed from connections where account = $1", [account]);
    if (!row) throw new PlatformError("This account is not connected.", true);
    const tokens = unseal<Tokens>(row.sealed);
    try {
      const next = await renewed(row.provider, tokens);
      if (!next) return tokens;
      await sql("update connections set sealed = $2, needs_reconnect = false where account = $1", [account, seal(next)]);
      return next;
    } catch (e) {
      if (e instanceof PlatformError && e.needsReconnect) await sql("update connections set needs_reconnect = true where account = $1", [account]);
      throw e;
    }
  })().finally(() => renewing.delete(account));
  renewing.set(account, job);
  return job;
}

export const markDead = (account: string) => sql("update connections set needs_reconnect = true where account = $1", [account]);
