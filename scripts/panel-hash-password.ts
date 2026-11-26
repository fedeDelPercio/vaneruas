import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { generatePassword, hashPassword, normalizeUsername, usernameValido, PASSWORD_MIN } from "../src/lib/auth/password";

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return readFileSync(0, "utf8").replace(/\r?\n$/, "");

  const stty = (mode: string) => execFileSync("stty", [mode], {
    stdio: [process.stdin, "pipe", "ignore"],
  }).toString().trim();
  const original = stty("-g");
  const terminal = createInterface({ input: process.stdin, terminal: false });
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once("SIGINT", interrupt);
  try {
    stty("-echo");
    process.stderr.write("Contraseña del panel: ");
    return await terminal.question("", { signal: abort.signal });
  } finally {
    terminal.close();
    stty(original);
    process.off("SIGINT", interrupt);
    process.stderr.write("\n");
  }
}

async function main() {
  const [flag, name = "equipo", ...rest] = process.argv.slice(2);
  if ((flag && flag !== "--generar") || rest.length) {
    throw new Error("Uso: npx tsx scripts/panel-hash-password.ts [--generar [usuario]]");
  }

  if (flag === "--generar") {
    const username = normalizeUsername(name);
    if (!usernameValido(username)) throw new Error("Usuario inválido");
    const password = generatePassword();
    const hash = await hashPassword(password);
    process.stdout.write(`Usuario: ${username}\nContraseña: ${password}\nPANEL_USERS: ${username}:${hash}\n`);
    return;
  }

  const password = await readPassword();
  if (password.length < PASSWORD_MIN || password.length > 200) {
    throw new Error(`La contraseña debe tener entre ${PASSWORD_MIN} y 200 caracteres`);
  }
  process.stdout.write(`${await hashPassword(password)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "No se pudo generar el hash");
  process.exitCode = 1;
});
