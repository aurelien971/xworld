import sharp from "sharp";

/**
 * The platforms, spoken to directly: sign-in, renewal, who the account is,
 * posting, and a post's numbers. The factory uses the developer apps it has
 * keys for (INSTAGRAM_APP_ID/SECRET, GOOGLE_OAUTH_CLIENT_ID/SECRET,
 * X_CLIENT_ID/SECRET); a platform with no keys is simply not offered.
 * Nothing here knows about briefs or accounts.
 */
export type Provider = "instagram" | "youtube" | "x" | "tiktok";
export const PROVIDERS: Provider[] = ["instagram", "tiktok", "youtube", "x"];
export const NAMES: Record<Provider, string> = { instagram: "Instagram", youtube: "YouTube", x: "X", tiktok: "TikTok" };

export type Tokens = { access: string; refresh?: string; expiresAt: number; renewAt?: number; userId?: string; username?: string };
export type Profile = { username: string; name?: string; avatar?: string; userId?: string };
export type Outgoing = { caption: string; title: string; images: { url: string; data: Buffer }[]; video?: { url: string; data: Buffer; seconds: number } };
export type Sent = { id: string; url?: string; status: "live" | "processing" };
export type Numbers = { views?: number; likes?: number; comments?: number; shares?: number };

/** A platform said no, in words a person can act on. needsReconnect: the sign-in itself is dead. */
export class PlatformError extends Error {
  constructor(message: string, public needsReconnect = false, public retry = false) {
    super(message);
  }
}

const env = (name: string) => process.env[name]?.trim() || "";
const KEYS: Record<Provider, [string, string]> = { instagram: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"], youtube: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"], x: ["X_CLIENT_ID", "X_CLIENT_SECRET"], tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"] };
/** TikTok is listed but not offered: its app only accepts its registered callback address and its posts stay private until TikTok audits the app. */
export const available = (p: Provider) => p !== "tiktok" && !!env(KEYS[p][0]) && !!env(KEYS[p][1]);
const creds = (p: Provider) => {
  if (!available(p)) throw new PlatformError(`${NAMES[p]} has no developer keys set.`);
  return { id: env(KEYS[p][0]), secret: env(KEYS[p][1]) };
};

const form = (body: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A platform's answer as JSON, or its refusal as a PlatformError. */
async function read<T>(r: Response, p: Provider, what: string): Promise<T> {
  const text = await r.text();
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(text);
  } catch {}
  const err = j.error as { message?: string; code?: number; error_user_msg?: string; errors?: { reason?: string }[] } | string | undefined;
  if (r.ok && !err) return j as T;
  const detail = (typeof err === "object" ? err?.error_user_msg || err?.message : err) || (j.error_description as string) || (j.detail as string) || (j.title as string) || text.slice(0, 160);
  const reason = typeof err === "object" ? err?.errors?.[0]?.reason ?? "" : "";
  const dead = r.status === 401 || (typeof err === "object" && err?.code === 190) || reason === "authError" || err === "invalid_grant";
  const slow = r.status === 429 || /quotaExceeded|rateLimit|uploadLimit/.test(reason) || (typeof err === "object" && [4, 17, 32, 613].includes(err?.code ?? 0));
  throw new PlatformError(dead ? `${NAMES[p]} refused the sign-in. Connect the account again.` : slow ? `${NAMES[p]} asked to slow down (${what}). It is tried again later.` : `${NAMES[p]} did not take it (${what}): ${String(detail).replace(/\.$/, "").slice(0, 160)}.`, dead, slow || r.status >= 500);
}

/* ───────────────────────── Sign-in ───────────────────────── */

const SCOPES = {
  instagram: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
  youtube: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
  x: "tweet.read tweet.write users.read media.write offline.access",
};

/** The platform's own sign-in page. challenge: the PKCE challenge (YouTube and X ask for one). */
export function authorizeUrl(p: Provider, redirectUri: string, state: string, challenge: string) {
  const { id } = creds(p);
  if (p === "instagram") return `https://www.instagram.com/oauth/authorize?${new URLSearchParams({ client_id: id, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.instagram, state })}`;
  if (p === "youtube") return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: id, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.youtube, state, access_type: "offline", prompt: "consent", include_granted_scopes: "true", code_challenge: challenge, code_challenge_method: "S256" })}`;
  return `https://x.com/i/oauth2/authorize?${new URLSearchParams({ response_type: "code", client_id: id, redirect_uri: redirectUri, scope: SCOPES.x, state, code_challenge: challenge, code_challenge_method: "S256" })}`;
}

type TokenReply = { access_token: string; refresh_token?: string; expires_in?: number };
const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

export async function exchange(p: Provider, code: string, redirectUri: string, verifier: string): Promise<Tokens> {
  const { id, secret } = creds(p);
  if (p === "instagram") {
    const short = await read<{ access_token?: string; user_id?: string | number; data?: { access_token: string; user_id: string | number }[] }>(
      await fetch("https://api.instagram.com/oauth/access_token", form({ client_id: id, client_secret: secret, grant_type: "authorization_code", redirect_uri: redirectUri, code: code.replace(/#_$/, "") })), p, "sign-in");
    const first = short.data?.[0] ?? short;
    if (!first.access_token) throw new PlatformError("Instagram sign-in did not work. Try again.");
    const long = await read<TokenReply>(await fetch(`https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: secret, access_token: first.access_token })}`), p, "long-lived sign-in");
    const expiresAt = Date.now() + (long.expires_in ?? 60 * 86400) * 1000;
    return { access: long.access_token, expiresAt, renewAt: Math.max(Date.now() + DAY, expiresAt - 30 * DAY), userId: first.user_id != null ? String(first.user_id) : undefined };
  }
  if (p === "youtube") {
    const t = await read<TokenReply>(await fetch("https://oauth2.googleapis.com/token", form({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier })), p, "sign-in");
    if (!t.refresh_token) throw new PlatformError("Google did not give a lasting sign-in. Remove the app from the Google account's connected apps, then connect again.");
    return { access: t.access_token, refresh: t.refresh_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 };
  }
  const t = await read<TokenReply>(await fetch("https://api.x.com/2/oauth2/token", { ...form({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier }), headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic(id, secret) } }), p, "sign-in");
  return { access: t.access_token, refresh: t.refresh_token, expiresAt: Date.now() + (t.expires_in ?? 7200) * 1000 };
}

export const expiresSoon = (t: Tokens) => !(t.expiresAt > Date.now() + 120_000) || (t.renewAt != null && t.renewAt <= Date.now());

/** A renewed sign-in when the current one is about to run out; null when nothing changed. X's renewal is single-use, so the result must be saved at once. */
export async function renewed(p: Provider, t: Tokens): Promise<Tokens | null> {
  if (!expiresSoon(t)) return null;
  const { id, secret } = creds(p);
  if (p === "instagram") {
    const long = await read<TokenReply>(await fetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: t.access })}`), p, "renewal");
    const expiresAt = Date.now() + (long.expires_in ?? 60 * 86400) * 1000;
    return { ...t, access: long.access_token, expiresAt, renewAt: Math.max(Date.now() + DAY, expiresAt - 30 * DAY) };
  }
  if (!t.refresh) throw new PlatformError(`The ${NAMES[p]} sign-in has run out. Connect the account again.`, true);
  if (p === "youtube") {
    const r = await read<TokenReply>(await fetch("https://oauth2.googleapis.com/token", form({ client_id: id, client_secret: secret, refresh_token: t.refresh, grant_type: "refresh_token" })), p, "renewal");
    return { ...t, access: r.access_token, refresh: r.refresh_token ?? t.refresh, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 };
  }
  const r = await read<TokenReply>(await fetch("https://api.x.com/2/oauth2/token", { ...form({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: id }), headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic(id, secret) } }), p, "renewal");
  return { ...t, access: r.access_token, refresh: r.refresh_token ?? t.refresh, expiresAt: Date.now() + (r.expires_in ?? 7200) * 1000 };
}

const GRAPH = "https://graph.instagram.com/v25.0";
const YT = "https://www.googleapis.com/youtube/v3";
const ig = {
  get: <T>(path: string, t: Tokens, q: Record<string, string>, what: string) => fetch(`${GRAPH}/${path}?${new URLSearchParams({ ...q, access_token: t.access })}`).then((r) => read<T>(r, "instagram", what)),
  post: <T>(path: string, t: Tokens, body: Record<string, string>, what: string) => fetch(`${GRAPH}/${path}`, form({ ...body, access_token: t.access })).then((r) => read<T>(r, "instagram", what)),
};
const bearer = (t: Tokens) => ({ Authorization: `Bearer ${t.access}` });

export async function profile(p: Provider, t: Tokens): Promise<Profile> {
  if (p === "instagram") {
    const me = await ig.get<{ id?: string; user_id?: string | number; username: string; name?: string; profile_picture_url?: string }>("me", t, { fields: "user_id,username,name,profile_picture_url" }, "profile");
    return { username: me.username, name: me.name, avatar: me.profile_picture_url, userId: String(me.user_id ?? me.id ?? t.userId ?? "") || undefined };
  }
  if (p === "youtube") {
    const j = await read<{ items?: { id: string; snippet?: { title?: string; customUrl?: string; thumbnails?: Record<string, { url: string }> } }[] }>(await fetch(`${YT}/channels?part=snippet&mine=true`, { headers: bearer(t) }), p, "channel");
    const c = j.items?.[0];
    if (!c) throw new PlatformError("This Google account has no YouTube channel yet. Create one on YouTube, then connect again.");
    return { username: c.snippet?.customUrl?.replace(/^@/, "") || c.snippet?.title || c.id, name: c.snippet?.title, avatar: c.snippet?.thumbnails?.default?.url, userId: c.id };
  }
  const u = (await read<{ data: { id: string; username: string; name: string; profile_image_url?: string } }>(await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", { headers: bearer(t) }), p, "profile")).data;
  return { username: u.username, name: u.name, avatar: u.profile_image_url, userId: u.id };
}

/* ───────────────────────── Posting ───────────────────────── */

/** Instagram: wait for a container to be processed. */
async function igReady(t: Tokens, id: string, budget: number) {
  const until = Date.now() + budget;
  for (;;) {
    const s = await ig.get<{ status_code?: string }>(id, t, { fields: "status_code" }, "processing check");
    if (s.status_code && s.status_code !== "IN_PROGRESS") return s.status_code;
    if (Date.now() > until) return "IN_PROGRESS";
    await sleep(4000);
  }
}

async function igPublish(t: Tokens, post: Outgoing): Promise<Sent> {
  const me = t.userId || (await profile("instagram", t)).userId;
  if (!me) throw new PlatformError("Instagram refused the sign-in. Connect the account again.", true);
  // Every post here is AI-edited, and says so.
  const ai = { is_ai_generated: "true" };
  let creation: string;
  if (post.video) {
    creation = (await ig.post<{ id: string }>(`${me}/media`, t, { media_type: "REELS", video_url: post.video.url, caption: post.caption, share_to_feed: "true", ...ai }, "reel")).id;
  } else if (post.images.length === 1) {
    creation = (await ig.post<{ id: string }>(`${me}/media`, t, { image_url: post.images[0].url, caption: post.caption, ...ai }, "picture")).id;
  } else {
    const children: string[] = [];
    for (const img of post.images.slice(0, 10)) children.push((await ig.post<{ id: string }>(`${me}/media`, t, { image_url: img.url, is_carousel_item: "true" }, "carousel picture")).id);
    for (const c of children) if (["ERROR", "EXPIRED"].includes(await igReady(t, c, 30_000))) throw new PlatformError("Instagram could not read one of the pictures.");
    creation = (await ig.post<{ id: string }>(`${me}/media`, t, { media_type: "CAROUSEL", children: children.join(","), caption: post.caption, ...ai }, "carousel")).id;
  }
  return igFinish(t, creation, post.video ? 150_000 : 60_000);
}

/** Instagram: publish a container once it is processed. Called again later for one that was still processing. */
export async function igFinish(t: Tokens, creation: string, budget = 0): Promise<Sent> {
  const me = t.userId || (await profile("instagram", t)).userId;
  const state = await igReady(t, creation, budget);
  if (state === "IN_PROGRESS") return { id: creation, status: "processing" };
  if (state === "ERROR" || state === "EXPIRED") throw new PlatformError("Instagram could not process it (a video must be an MP4 of 3 seconds to 15 minutes).");
  if (state !== "PUBLISHED") {
    const { id } = await ig.post<{ id: string }>(`${me}/media_publish`, t, { creation_id: creation }, "publishing");
    const m = await ig.get<{ permalink?: string }>(id, t, { fields: "permalink" }, "link").catch(() => ({ permalink: undefined }));
    return { id, url: m.permalink, status: "live" };
  }
  return { id: creation, status: "live" };
}

async function ytPublish(t: Tokens, post: Outgoing): Promise<Sent> {
  if (!post.video) throw new PlatformError("YouTube takes videos only.");
  const meta = {
    snippet: { title: post.title.slice(0, 100), description: `${post.caption}\n\n#Shorts`.slice(0, 4900), categoryId: "22" },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
  };
  const boundary = `factory${Date.now().toString(36)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`),
    post.video.data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const j = await read<{ id: string; status?: { privacyStatus?: string } }>(
    await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status", { method: "POST", headers: { ...bearer(t), "Content-Type": `multipart/related; boundary=${boundary}` }, body: new Uint8Array(body) }), "youtube", "upload");
  return { id: j.id, url: `https://www.youtube.com/shorts/${j.id}`, status: "live" };
}

async function xPublish(t: Tokens, post: Outgoing): Promise<Sent> {
  const ids: string[] = [];
  if (post.video) {
    const bytes = post.video.data;
    const init = await read<{ data: { id: string } }>(await fetch("https://api.x.com/2/media/upload/initialize", { method: "POST", headers: { ...bearer(t), "Content-Type": "application/json" }, body: JSON.stringify({ media_type: "video/mp4", total_bytes: bytes.length, media_category: "tweet_video" }) }), "x", "video");
    const CHUNK = 4 * 1024 * 1024;
    for (let i = 0, seg = 0; i < bytes.length; i += CHUNK, seg++) {
      const f = new FormData();
      f.append("media", new Blob([new Uint8Array(bytes.subarray(i, i + CHUNK))]), "chunk");
      f.append("segment_index", String(seg));
      await read(await fetch(`https://api.x.com/2/media/upload/${init.data.id}/append`, { method: "POST", headers: bearer(t), body: f }), "x", "video");
    }
    let fin = await read<{ data: { processing_info?: { state: string; check_after_secs?: number } } }>(await fetch(`https://api.x.com/2/media/upload/${init.data.id}/finalize`, { method: "POST", headers: bearer(t) }), "x", "video");
    for (let n = 0; fin.data.processing_info && ["pending", "in_progress"].includes(fin.data.processing_info.state) && n < 30; n++) {
      await sleep((fin.data.processing_info.check_after_secs ?? 2) * 1000);
      fin = await read(await fetch(`https://api.x.com/2/media/upload?command=STATUS&media_id=${init.data.id}`, { headers: bearer(t) }), "x", "video");
    }
    if (fin.data.processing_info?.state === "failed") throw new PlatformError("X could not process the video.");
    ids.push(init.data.id);
  } else {
    for (const img of post.images.slice(0, 4)) {
      const f = new FormData();
      f.append("media", new Blob([new Uint8Array(await sharp(img.data).jpeg({ quality: 90 }).toBuffer())], { type: "image/jpeg" }), "picture.jpg");
      f.append("media_category", "tweet_image");
      f.append("media_type", "image/jpeg");
      ids.push((await read<{ data: { id: string } }>(await fetch("https://api.x.com/2/media/upload", { method: "POST", headers: bearer(t), body: f }), "x", "picture")).data.id);
    }
  }
  const j = await read<{ data: { id: string } }>(await fetch("https://api.x.com/2/tweets", { method: "POST", headers: { ...bearer(t), "Content-Type": "application/json" }, body: JSON.stringify({ text: post.caption.slice(0, 280), ...(ids.length ? { media: { media_ids: ids } } : {}) }) }), "x", "post");
  return { id: j.data.id, url: `https://x.com/${t.username ?? "i/web"}/status/${j.data.id}`, status: "live" };
}

export const publish = (p: Provider, t: Tokens, post: Outgoing): Promise<Sent> => (p === "instagram" ? igPublish(t, post) : p === "youtube" ? ytPublish(t, post) : xPublish(t, post));

/* ───────────────────────── Numbers ───────────────────────── */

/** A post's numbers as the platform reports them now. Missing numbers are left out, never guessed. */
export async function numbers(p: Provider, t: Tokens, id: string): Promise<Numbers> {
  if (p === "instagram") {
    const m = await ig.get<{ like_count?: number; comments_count?: number }>(id, t, { fields: "like_count,comments_count" }, "numbers");
    const insights = await ig.get<{ data?: { name: string; values?: { value?: number }[]; total_value?: { value?: number } }[] }>(`${id}/insights`, t, { metric: "views,shares" }, "numbers").catch(() => ({ data: [] }));
    const of = (name: string) => {
      const d = insights.data?.find((x) => x.name === name);
      return d?.total_value?.value ?? d?.values?.[0]?.value;
    };
    return { views: of("views"), likes: m.like_count, comments: m.comments_count, shares: of("shares") };
  }
  if (p === "youtube") {
    const j = await read<{ items?: { statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(await fetch(`${YT}/videos?part=statistics&id=${encodeURIComponent(id)}`, { headers: bearer(t) }), p, "numbers");
    const s = j.items?.[0]?.statistics;
    const n = (v?: string) => (v == null ? undefined : Number(v));
    return { views: n(s?.viewCount), likes: n(s?.likeCount), comments: n(s?.commentCount) };
  }
  const j = await read<{ data?: { public_metrics?: { impression_count?: number; like_count?: number; reply_count?: number; retweet_count?: number } } }>(await fetch(`https://api.x.com/2/tweets/${id}?tweet.fields=public_metrics`, { headers: bearer(t) }), p, "numbers");
  const m = j.data?.public_metrics;
  return { views: m?.impression_count, likes: m?.like_count, comments: m?.reply_count, shares: m?.retweet_count };
}
