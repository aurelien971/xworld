import type { LiveAccount } from "../accounts";
import * as mitsushiro from "../mitsushiro";
import { get } from "../storage";
import { TZ } from "../time";
import type { Brief, Metrics, Publish } from "../types";

/**
 * Handing a finished post to Mitsushiro. The factory sends the slides or
 * the video and the words; Mitsushiro stores them in the creator's folder,
 * posts at the due time, and answers later with where the post stands and
 * its numbers. Nothing is sent unless the account is connected and active.
 */
export function publishBlocker(account: LiveAccount): string | null {
  if (!mitsushiro.configured()) return "The publisher is not configured";
  if (!account.model) return "This persona is not linked to a creator yet";
  if (!account.connected) return "This account is not connected yet";
  if (account.needsReconnect) return "This account needs reconnecting";
  if (account.status !== "active") return account.status === "paused" ? "Account is paused" : "Account is warming";
  return null;
}

export async function send(brief: Brief, account: LiveAccount, hashtags: string[]): Promise<Publish> {
  const blocker = publishBlocker(account);
  if (blocker) throw new Error(blocker);
  const form = new FormData();
  form.set("meta", JSON.stringify({
    model: account.model, id: brief.id, platform: account.platform, handle: account.handle, format: brief.video ? "video" : "carousel",
    caption: brief.caption ?? "", hashtags, date: brief.day, time: brief.inputs.time, tz: TZ, seconds: brief.video?.seconds,
  }));
  if (brief.video) form.append("video", new Blob([new Uint8Array(await get(brief.video.key))], { type: "video/mp4" }), "video.mp4");
  else for (const [i, s] of brief.slides.entries()) form.append("images", new Blob([new Uint8Array(await get(s.key))], { type: "image/jpeg" }), `${i + 1}.jpg`);
  const sent = await mitsushiro.sendPost(form);
  return { target: "mitsushiro", status: "queued", ref: sent.post, dueAt: sent.due, at: new Date().toISOString() };
}

export type Standing = { status: Publish["status"]; url?: string; error?: string; metrics?: Omit<Metrics, "at"> };

/** Where a sent post stands, and its numbers once the platform reports them. */
export async function standing(brief: Brief, account: LiveAccount): Promise<Standing | null> {
  if (!account.model || !mitsushiro.configured() || !brief.publish?.ref) return null;
  return mitsushiro.standingOf({ model: account.model, post: brief.publish.ref, platform: account.platform, handle: account.handle }).catch(() => null);
}
