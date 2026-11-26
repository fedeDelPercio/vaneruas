import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";
import { POST as login } from "../src/app/api/auth/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth/session";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import { parsePanelUsers } from "../src/lib/auth/users";

function request(path: string, method = "GET", token?: string) {
  const headers = token ? { cookie: `${SESSION_COOKIE}=${token}` } : undefined;
  return new NextRequest(`http://localhost:3199${path}`, { method, headers });
}

function credentials(username: string, password: string, ip = "192.0.2.1") {
  return new NextRequest("http://localhost:3199/api/auth/login", {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

async function main() {
  process.env.AUTH_SECRET = "session-secret-for-tests";
  const password = "clave-de-prueba";
  const hash = await hashPassword(password);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("equivocada", hash), false);
  process.env.PANEL_USERS = ` Equipo : ${hash}, inválido:${hash}, basura, falso:scrypt$0$0$0$$, otro:${hash}:extra`;
  assert.deepEqual([...parsePanelUsers(process.env.PANEL_USERS).entries()], [["equipo", hash]]);
  console.log("OK scrypt y parseo de cuentas");

  const protectedRoutes = [
    ["POST", "/api/wa/messages/abc"],
    ["GET", "/api/wa/conversations"],
    ["POST", "/api/wa/mode/abc"],
    ["POST", "/api/wa/messages/abc.txt"],
    ["GET", "/api/auth/supabase-token"],
    ["POST", "/api/webhooks/incoming"],
    ["POST", "/api/transcribe"],
    ["GET", "/api/ghl/conversation"],
  ];
  for (const [method, path] of protectedRoutes) {
    const response = await middleware(request(path!, method));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "No autenticado" });
  }
  for (const path of ["/conversations", "/feedback?period=7"]) {
    const response = await middleware(request(path));
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("volver"), path);
  }

  const token = await createSessionToken("equipo");
  assert.equal((await middleware(request("/api/wa/conversations", "GET", token))).headers.get("x-middleware-next"), "1");
  for (const badToken of [`A${token}`, await createSessionToken("equipo", -1)]) {
    assert.equal((await middleware(request("/api/wa/conversations", "GET", badToken))).status, 401);
  }
  console.log("OK rutas protegidas, redirección y firma de sesión");

  for (const path of [
    "/api/jobs/process", "/api/jobs/import-human",
    "/api/webhooks/ghl/inbound", "/api/webhooks/ghl/message", "/api/webhooks/ghl/mode",
    "/api/ghl/oauth/callback", "/login", "/api/auth/login", "/api/auth/logout",
  ]) {
    assert.equal((await middleware(request(path))).headers.get("x-middleware-next"), "1");
  }
  console.log("OK excepciones de middleware");

  const plainLogin = await login(new NextRequest("http://localhost:3199/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "equipo", password }),
  }));
  assert.equal(plainLogin.status, 415);

  const validLogin = await login(credentials(" Equipo ", password));
  assert.equal(validLogin.status, 200);
  const cookie = validLogin.cookies.get(SESSION_COOKIE);
  assert.equal(cookie?.httpOnly, true);
  assert.equal(cookie?.sameSite, "lax");
  assert.equal(cookie?.maxAge, 30 * 24 * 60 * 60);
  assert.equal((await middleware(request("/conversations", "GET", cookie?.value))).headers.get("x-middleware-next"), "1");
  assert.equal((await logout()).cookies.get(SESSION_COOKIE)?.maxAge, 0);

  const wrong = await login(credentials("equipo", "incorrecta"));
  const unknown = await login(credentials("desconocido", password));
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await wrong.json(), await unknown.json());
  for (let i = 0; i < 10; i++) {
    assert.equal((await login(credentials("equipo", "incorrecta", "192.0.2.2"))).status, 401);
  }
  assert.equal((await login(credentials("equipo", password, "192.0.2.2"))).status, 429);

  process.env.PANEL_USERS = "";
  const unconfigured = await login(credentials("equipo", password));
  assert.equal(unconfigured.status, 503);
  assert.deepEqual(await unconfigured.json(), { error: "El acceso al panel no está configurado" });
  assert.equal((await middleware(request("/api/wa/conversations", "GET", token))).status, 401);
  console.log("OK login, logout, límite de intentos y revocación");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
