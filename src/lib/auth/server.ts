import "server-only";

import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "./session";
import { parsePanelUsers } from "./users";

export async function getSessionUser(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token);
  if (!session || !parsePanelUsers(process.env.PANEL_USERS).has(session.sub)) return null;
  return session.sub;
}
