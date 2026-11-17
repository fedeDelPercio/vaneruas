import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAiScaleMapTicket, TicketIntakeError } from "@/lib/aiscalemap";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ===========================================================================
// POST /api/tickets   (multipart: profileId, kind, body, page, images[])
//
// El botón de feedback del header: crea un ticket en AI ScaleMap con lo que
// escribió la persona, sus capturas, quién es y desde qué pantalla. "mejora"
// es una idea o algo para cambiar; "bug", algo que no anda. Devuelve el número
// de ticket.
//
// No hay campo de título: es la primera línea del texto, como en el feedback
// del propio panel de AI ScaleMap.
// ===========================================================================

const MAX_IMAGES = 10;
// Vercel corta los pedidos de más de 4,5 MB. El navegador ya achica las
// capturas antes de mandarlas; esto es el freno por si no alcanzó.
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const fieldsSchema = z.object({
  profileId: z.string().uuid(),
  kind: z.enum(["mejora", "bug"]),
  body: z.string().trim().max(20000),
  page: z.string().trim().max(500).nullable(),
});

function titleFrom(body: string, kind: "mejora" | "bug"): string {
  const first = body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!first) return kind === "bug" ? "Bug con captura" : "Mejora con captura";
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}...` : first;
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "No se pudo leer lo que mandaste" }, { status: 400 });
  }
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : null;
  };
  const parsed = fieldsSchema.safeParse({
    profileId: text("profileId"),
    kind: text("kind"),
    // Un formulario multipart manda los saltos de línea como CRLF.
    body: (text("body") ?? "").replace(/\r\n?/g, "\n"),
    page: text("page"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Faltan datos para mandarlo" }, { status: 400 });
  }
  const { profileId, kind, body, page } = parsed.data;

  const images = form.getAll("images").filter((v): v is File => typeof v !== "string");
  if (!body && images.length === 0) {
    return NextResponse.json({ error: "Escribí algo o pegá una captura" }, { status: 400 });
  }
  if (images.length > MAX_IMAGES) {
    return NextResponse.json({ error: `Hasta ${MAX_IMAGES} capturas por envío` }, { status: 400 });
  }
  if (images.some((img) => !IMAGE_TYPES.has(img.type))) {
    return NextResponse.json({ error: "Las capturas tienen que ser imágenes" }, { status: 400 });
  }
  if (images.reduce((sum, img) => sum + img.size, 0) > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      { error: "Las capturas pesan demasiado juntas. Sacá alguna y mandala en otro envío" },
      { status: 413 },
    );
  }

  // El nombre sale de la base, no del navegador.
  const { data: profile } = await getSupabaseServerClient()
    .from("profiles")
    .select("name")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ error: "Elegí un perfil para mandarlo" }, { status: 403 });
  }

  try {
    const ticket = await createAiScaleMapTicket({
      kind,
      title: titleFrom(body, kind),
      body,
      reporter: `${profile.name} (panel Vanesa Rúas)`,
      page,
      images,
    });
    return NextResponse.json(ticket);
  } catch (err) {
    const status = err instanceof TicketIntakeError ? err.status : 500;
    const message = err instanceof Error ? err.message : "No se pudo mandar";
    return NextResponse.json({ error: message }, { status });
  }
}
