import "server-only";

import { createHmac } from "node:crypto";
import { clientEnv } from "@/lib/env";

const TOKEN_AGE_S = 60 * 60;

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function readExpiration(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : null;
  } catch {
    return null;
  }
}

export function getSupabasePanelToken(): { token: string; exp: number } {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_AGE_S;
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    // La variable heredada se lee en runtime, fuera de la sustitución
    // estática de NEXT_PUBLIC_* que hace Next al compilar.
    const legacyName: string = "NEXT_PUBLIC_SUPABASE_CLIENT_JWT";
    const token = process.env.SUPABASE_CLIENT_JWT || process.env[legacyName];
    if (!token) throw new Error("Falta configurar el token de Supabase del panel");
    return { token, exp: readExpiration(token) ?? exp };
  }

  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ role: "anon", client_slug: clientEnv.NEXT_PUBLIC_CLIENT_SLUG, iat, exp });
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return { token: `${header}.${payload}.${signature}`, exp };
}
