import type { LiveAccount } from "../accounts";
import { markDead, tokensFor } from "../connections";
import { igFinish, numbers, PlatformError, publish, type Outgoing, type Provider } from "../platforms";
import { get, publicUrl } from "../storage";
import type { Brief, Metrics, Publish } from "../types";

/**
 * Posting a finished brief, straight to the platform, from the account
 * connected to its slot. Nothing goes out unless that account is connected,
 * its sign-in is alive and posting is switched on for it.
 */
export function publishBlocker(account: LiveAccount): string | null {
  if (!account.connected) return account.offered ? "This account is not connected yet" : "This platform has no developer keys yet";
  if (account.needsReconnect) return "This account needs connecting again";
  if (account.status === "paused") return "This account is paused";
  if (!account.posting) return "Posting is switched off for this account";
  return null;
}

const withTags = (caption: string, tags: string[], max: number) => {
  const line = tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ");
  return `${caption}${line ? `\n\n${line}` : ""}`.slice(0, max);
};

export async function send(brief: Brief, account: LiveAccount, hashtags: string[]): Promise<Publish> {
  const blocker = publishBlocker(account);
  if (blocker) throw new Error(blocker);
  const provider = account.platform as Provider;
  const tokens = await tokensFor(account.id);
  // Instagram fetches the media itself, so each file needs an address on the open web; the others take the bytes.
  const needsUrl = provider === "instagram";
  const file = async (key: string) => {
    const data = await get(key);
    return { data, url: needsUrl ? await publicUrl(key, data) : "" };
  };
  const post: Outgoing = {
    caption: provider === "x" ? withTags(brief.caption ?? "", hashtags.slice(0, 2), 280) : withTags(brief.caption ?? "", hashtags, 2200),
    title: (brief.inputs.hookText ?? brief.caption ?? "").split("\n")[0].slice(0, 100) || "Opaque",
    images: brief.video ? [] : await Promise.all(brief.slides.map((s) => file(s.key))),
    video: brief.video ? { ...(await file(brief.video.key)), seconds: brief.video.seconds } : undefined,
  };
  try {
    const sent = await publish(provider, { ...tokens, username: account.handle }, post);
    return { target: provider, status: sent.status === "live" ? "live" : "sent", ref: sent.id, url: sent.url, at: new Date().toISOString() };
  } catch (e) {
    if (e instanceof PlatformError && e.needsReconnect) await markDead(account.id);
    throw e;
  }
}

export type Standing = { status: Publish["status"]; ref?: string; url?: string; error?: string; metrics?: Omit<Metrics, "at"> };

/** Where a sent post stands: finished off if the platform was still processing it, and its numbers once it is live. */
export async function standing(brief: Brief, account: LiveAccount): Promise<Standing | null> {
  if (!account.connected || !brief.publish?.ref) return null;
  const provider = account.platform as Provider;
  const tokens = await tokensFor(account.id);
  if (brief.publish.status === "sent") {
    if (provider !== "instagram") return null;
    const done = await igFinish(tokens, brief.publish.ref);
    return done.status === "live" ? { status: "live", ref: done.id, url: done.url } : { status: "sent" };
  }
  if (brief.publish.status !== "live") return null;
  return { status: "live", metrics: await numbers(provider, tokens, brief.publish.ref) };
}
