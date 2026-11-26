import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, createSessionToken } from "@/lib/auth/session";
import { normalizeUsername, parsePanelUsers } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { count: number; expires: number }>();
// Sal y derivada ficticias de los mismos tamaños y costo que un hash real.
const DUMMY_HASH = `scrypt$16384$8$1$${"A".repeat(22)}==$${"A".repeat(86)}==`;

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  for (const [key, attempt] of attempts) {
    if (attempt.expires > now) break;
    attempts.delete(key);
  }
  const previous = attempts.get(ip);
  if (previous) return ++previous.count > MAX_ATTEMPTS;
  attempts.set(ip, { count: 1, expires: now + WINDOW_MS });
  return false;
}

const credentials = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const users = parsePanelUsers(process.env.PANEL_USERS);
  if (!users.size) {
    return NextResponse.json({ error: "El acceso al panel no está configurado" }, { status: 503 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") || "sin-ip";
  if (tooManyAttempts(ip)) {
    return NextResponse.json({ error: "Demasiados intentos. Probá de nuevo en unos minutos." }, { status: 429 });
  }

  // Un formulario de otro origen no puede enviar application/json.
  const contentType = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return NextResponse.json({ error: "Formato de solicitud inválido" }, { status: 415 });
  }

  const parsed = credentials.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Completá usuario y contraseña" }, { status: 400 });
  }

  const username = normalizeUsername(parsed.data.username);
  const hash = users.get(username);
  const valid = await verifyPassword(parsed.data.password, hash ?? DUMMY_HASH);
  if (!hash || !valid) {
    return NextResponse.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(username), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  attempts.delete(ip);
  return response;
}
