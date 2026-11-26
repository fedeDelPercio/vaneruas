// Sesión del panel firmada con Web Crypto, compartida por Edge y Node.

export const SESSION_COOKIE = "vr_session";
/** 30 días: el equipo de la clínica no debería tener que loguearse seguido. */
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

export interface SessionPayload {
  /** Usuario normalizado */
  sub: string;
  /** Epoch en segundos. */
  exp: number;
}

function secret(): string {
  const s = process.env.AUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Falta AUTH_SECRET (o SUPABASE_SERVICE_ROLE_KEY) para firmar la sesión");
  return `vr-panel-session:${s}`;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Firma un token de sesión para ese usuario. */
export async function createSessionToken(
  username: string,
  maxAgeSeconds = SESSION_MAX_AGE_S,
): Promise<string> {
  const payload: SessionPayload = {
    sub: username,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
  };
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const firma = await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(firma))}`;
}

/** Payload del token si la firma es válida y no venció; null en cualquier otro caso. */
export async function readSessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, firma, extra] = token.split(".");
  if (!body || !firma || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await key(),
      b64urlDecode(firma) as unknown as ArrayBuffer,
      new TextEncoder().encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as SessionPayload;
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
