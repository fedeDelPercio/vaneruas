import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// ===========================================================================
// Contraseñas del panel.
//
// scrypt de node:crypto (sin dependencias nuevas). Formato del hash guardado:
//
//   scrypt$<N>$<r>$<p>$<salt base64>$<derivada base64>
//
// Los parámetros van adentro del string para poder subirlos en el futuro sin
// invalidar las contraseñas ya guardadas.
//
// Solo corre en el servidor (Node): el middleware NO usa este módulo, ahí
// solo se verifica la firma de la cookie (ver session.ts).
// ===========================================================================

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivada = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), derivada.toString("base64")].join("$");
}

/** Comparación en tiempo constante. Nunca lanza: un hash raro es "no coincide". */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  try {
    const [algo, n, r, p, saltB64, hashB64] = stored.split("$");
    if (algo !== "scrypt") return false;
    const esperado = Buffer.from(hashB64 ?? "", "base64");
    if (esperado.length !== KEYLEN) return false;
    const derivada = await scrypt(
      password.normalize("NFKC"),
      Buffer.from(saltB64 ?? "", "base64"),
      esperado.length,
      { N: Number(n), r: Number(r), p: Number(p) },
    );
    return derivada.length === esperado.length && timingSafeEqual(derivada, esperado);
  } catch {
    return false;
  }
}

/**
 * Largo mínimo de una contraseña elegida a mano. Desde 2026-09-15 quien crea
 * el usuario puede escribirla él (pedido de Federico: "no quiero que tenga una
 * contraseña que sea un chino"), así que hace falta un piso: la generada son
 * 12 caracteres al azar, la tipeada suele ser mucho más pobre.
 */
export const PASSWORD_MIN = 8;

// Sin caracteres que se confunden al dictarla o copiarla a mano (l/I/1, O/0).
const ALFABETO = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Contraseña legible para repartir a mano (12 caracteres, ~70 bits). */
export function generatePassword(largo = 12): string {
  const bytes = randomBytes(largo);
  let out = "";
  for (let i = 0; i < largo; i++) out += ALFABETO[bytes[i]! % ALFABETO.length];
  return out;
}

export { normalizeUsername, usernameValido } from "./users";
