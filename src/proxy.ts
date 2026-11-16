import { NextResponse, type NextRequest } from "next/server";
import { allowed, COOKIE } from "@/factory/gate";

/** Everything is behind the password except the sign-in page itself. */
export async function proxy(req: NextRequest) {
  if (await allowed(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/") || req.nextUrl.pathname.startsWith("/media/")) return new NextResponse("Not found", { status: 404 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!login|api/login|_next/|favicon.ico).*)"] };
