import { get } from "../storage";
import { TZ } from "../time";
import type { Account, Brief, Metrics, Publish } from "../types";

/**
 * Handing a finished post to Mitsushiro, which holds the accounts' sign-ins
 * and runs the clock. The factory sends the slides and the words; Mitsushiro
 * stores them in its own bucket, posts at the due time, and answers later
 * with where the post stands and its numbers. Nothing is sent unless the
 * account is active, has a target, and the two settings below are present.
 */
const base = () => process.env.MITSUSHIRO_URL?.replace(/\/$/, "");
const secret = () => process.env.MITSUSHIRO_INGEST_SECRET?.trim();

export function publishBlocker(account: Account): string | null {
  if (account.status !== "active") return account.status === "warming" ? "Account is warming" : "Account is paused";
  if (!account.target) return "Account is not connected";
  if (!base() || !secret()) return "Publisher is not configured";
  return null;
}

export async function send(brief: Brief, account: Account, hashtags: string[]): Promise<Publish> {
  const blocker = publishBlocker(account);
  if (blocker) throw new Error(blocker);
  const form = new FormData();
  form.set("meta", JSON.stringify({
    uid: account.target!.uid, model: account.target!.model, id: brief.id, platform: account.platform, handle: account.handle,
    format: "carousel", caption: brief.caption ?? "", hashtags, date: brief.day, time: brief.inputs.time, tz: TZ,
  }));
  for (const [i, s] of brief.slides.entries()) form.append("images", new Blob([new Uint8Array(await get(s.key))], { type: "image/jpeg" }), `${i + 1}.jpg`);
  const res = await fetch(`${base()}/api/ingest/post`, { method: "POST", headers: { Authorization: `Bearer ${secret()}` }, body: form, signal: AbortSignal.timeout(120_000) });
  const body = (await res.json().catch(() => null)) as { post?: string; due?: string; error?: string } | null;
  if (!res.ok || !body?.post) throw new Error(body?.error || `The publisher answered ${res.status}.`);
  return { target: "mitsushiro", status: "queued", ref: body.post, dueAt: body.due, at: new Date().toISOString() };
}

export type Standing = { status: Publish["status"]; url?: string; error?: string; metrics?: Omit<Metrics, "at"> };

/** Where a sent post stands, and its numbers once the platform reports them. */
export async function standing(brief: Brief, account: Account): Promise<Standing | null> {
  if (!account.target || !base() || !secret() || !brief.publish?.ref) return null;
  const q = new URLSearchParams({ uid: account.target.uid, model: account.target.model, post: brief.publish.ref, platform: account.platform, handle: account.handle });
  const res = await fetch(`${base()}/api/ingest/post?${q}`, { headers: { Authorization: `Bearer ${secret()}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) return null;
  return (await res.json()) as Standing;
}
