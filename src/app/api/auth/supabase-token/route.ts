import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/server";
import { getSupabasePanelToken } from "@/lib/auth/supabase-token";

export const dynamic = "force-dynamic";

const headers = { "cache-control": "private, no-store" };

export async function GET() {
  if (!(await getSessionUser())) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers });
  }

  try {
    return NextResponse.json(getSupabasePanelToken(), { headers });
  } catch {
    return NextResponse.json({ error: "El acceso a Supabase no está configurado" }, { status: 503, headers });
  }
}
