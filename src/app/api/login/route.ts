import { timingSafeEqual } from "node:crypto";
import { COOKIE, password, sessionFor } from "@/factory/gate";

/** Checks the password and sets the session cookie for 30 days. */
export async function POST(req: Request) {
  const { password: given } = (await req.json().catch(() => ({}))) as { password?: string };
  const want = password();
  const a = Buffer.from(String(given ?? "")), b = Buffer.from(want);
  if (!want || a.length !== b.length || !timingSafeEqual(a, b)) {
    await new Promise((r) => setTimeout(r, 400));
    return Response.json({ error: "That's not it." }, { status: 401 });
  }
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Response.json({ ok: true }, { headers: { "Set-Cookie": `${COOKIE}=${await sessionFor(want)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}` } });
}
