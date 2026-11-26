// Compatible con Edge. Solo los hashes válidos habilitan una cuenta.
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function usernameValido(username: string): boolean {
  return /^[a-z0-9._-]{3,32}$/.test(username);
}

export function parsePanelUsers(raw: string | undefined): Map<string, string> {
  const users = new Map<string, string>();
  for (const entry of (raw ?? "").split(",")) {
    const [name, value, extra] = entry.split(":");
    const username = normalizeUsername(name ?? "");
    const hash = value?.trim() ?? "";
    // Formato emitido por hashPassword: sal de 16 bytes y derivada de 64.
    // Se acota el costo a los parámetros que usa el script.
    if (extra === undefined && usernameValido(username) &&
        /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/]{21}[AQgw]==\$[A-Za-z0-9+/]{85}[AQgw]==$/.test(hash)) {
      users.set(username, hash);
    }
  }
  return users;
}
