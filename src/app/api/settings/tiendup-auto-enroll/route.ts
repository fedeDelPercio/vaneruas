import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRole } from "@/lib/supabase/types";
import {
  AutoEnrollTableMissingError,
  getTiendupAutoEnrollSetting,
  setTiendupAutoEnroll,
} from "@/lib/tiendup/auto-enroll-setting";

export const dynamic = "force-dynamic";

// ===========================================================================
// GET / PATCH /api/settings/tiendup-auto-enroll
//
// Interruptor "Alta automática en Tiendup" (/payments → Falta acceso).
// Se guarda en agent_settings.auto_send.tiendup_auto_enroll (ver
// src/lib/tiendup/auto-enroll-setting.ts). Si no hay valor en la base manda
// la env TIENDUP_AUTO_ENROLL, y si tampoco, prendido.
//
// Auth (fase 1, sin auth real): igual que el resto del panel, el perfil activo
// viaja desde el navegador y el rol se lee de la base, no del cliente.
//   - GET  ?profileId=…  → leen los roles con acceso a /payments.
//   - PATCH { enabled, profileId } → solo dev y client (asesor 403).
// ===========================================================================

const READ_ROLES: ProfileRole[] = ["dev", "client", "asesor"];
const EDIT_ROLES: ProfileRole[] = ["dev", "client"];

const patchSchema = z.object({
  enabled: z.boolean(),
  profileId: z.string().uuid(),
});

async function profileById(id: string): Promise<{ name: string; role: ProfileRole } | null> {
  const { data } = await getSupabaseServerClient()
    .from("profiles")
    .select("name, role")
    .eq("id", id)
    .maybeSingle();
  return data ? { name: data.name, role: data.role as ProfileRole } : null;
}

export async function GET(req: NextRequest) {
  const profileId = req.nextUrl.searchParams.get("profileId");
  const viewer =
    profileId && z.string().uuid().safeParse(profileId).success
      ? await profileById(profileId)
      : null;
  if (!viewer || !READ_ROLES.includes(viewer.role)) {
    return NextResponse.json({ error: "Elegí un perfil con acceso a Aprobaciones" }, { status: 403 });
  }

  const s = await getTiendupAutoEnrollSetting();
  const updatedBy = s.updatedById ? (await profileById(s.updatedById))?.name ?? null : null;
  return NextResponse.json({
    enabled: s.enabled,
    source: s.source,
    updatedAt: s.updatedAt,
    updatedBy,
    canEdit: EDIT_ROLES.includes(viewer.role),
    tableMissing: s.tableMissing,
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Pedido inválido ({ enabled, profileId })" }, { status: 400 });
  }
  const { enabled, profileId } = parsed.data;

  const editor = await profileById(profileId);
  if (!editor || !EDIT_ROLES.includes(editor.role)) {
    return NextResponse.json(
      { error: "Tu perfil no puede cambiar el alta automática" },
      { status: 403 },
    );
  }

  try {
    await setTiendupAutoEnroll(enabled, profileId);
  } catch (err) {
    if (err instanceof AutoEnrollTableMissingError) {
      return NextResponse.json({ error: "Falta aplicar la migración 033" }, { status: 503 });
    }
    console.error("[tiendup] no se pudo guardar el alta automática:", err);
    return NextResponse.json({ error: "No se pudo guardar el cambio" }, { status: 500 });
  }

  const s = await getTiendupAutoEnrollSetting();
  return NextResponse.json({
    enabled: s.enabled,
    source: s.source,
    updatedAt: s.updatedAt,
    updatedBy: editor.name,
    canEdit: true,
  });
}
