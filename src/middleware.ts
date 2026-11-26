import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { parsePanelUsers } from "@/lib/auth/users";

const publicPaths = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/ghl/oauth/callback",
  "/brand/vanesa-ruas.png",
  "/icon.png",
]);

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (publicPaths.has(pathname) ||
      pathname.startsWith("/api/webhooks/ghl/") ||
      pathname.startsWith("/api/jobs/")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token);
  if (session && parsePanelUsers(process.env.PANEL_USERS).has(session.sub)) {
    return NextResponse.next();
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("volver", pathname + search);
  const response = NextResponse.redirect(url);
  if (token) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const config = {
  // Los IDs de rutas dinámicas pueden contener puntos.
  matcher: ["/((?!_next/static/|_next/image$|favicon\\.ico$).*)"],
};
