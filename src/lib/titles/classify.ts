import "server-only";

import { getAnthropicClient } from "@/lib/agent/llm-client";
import { serverEnv } from "@/lib/env";

// ===========================================================================
// Clasificador + validador de imagen con Claude vision.
//
// Para una contacta NO registrada que manda un adjunto, necesitamos saber si
// es un comprobante de pago o un título profesional, y si es un título, si es
// un certificado real (de cosmetología o afín). Una sola llamada de vision
// resuelve ambas cosas: clasifica y, si es título, lo valida.
//
// El comprobante después se procesa con el extractor dedicado
// (`payments/extract.ts`); acá solo nos importa el ENRUTAMIENTO + la validez
// del título.
// ===========================================================================

export type AttachmentKind = "comprobante" | "titulo" | "meme" | "otro";

export interface AttachmentClassification {
  kind: AttachmentKind;
  // Solo relevante si kind === "titulo".
  title_is_valid: boolean; // ¿es un certificado/título profesional genuino?
  holder_name: string | null; // nombre de la titular, si se lee
  title_name: string | null; // ej. "Técnica en Cosmetología"
  institution: string | null; // institución emisora
  confidence: "alta" | "media" | "baja";
  note: string | null; // por qué se consideró válido o no
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: ["comprobante", "titulo", "meme", "otro"],
      description:
        "Clasificá la imagen: 'comprobante' si es un comprobante de transferencia o pago bancario; 'titulo' si es un título, diploma, certificado de estudios profesional o una constancia/certificado de alumno regular (en curso) de una formación del rubro; 'meme' si es un meme, GIF, sticker, imagen de reacción, captura graciosa, foto de una persona/famoso reaccionando, o cualquier imagen que claramente NO es un documento (no es comprobante ni título) y que se mandó como reacción o broma; 'otro' para cualquier otra cosa que no encaje (foto suelta no relacionada, captura ambigua). Ante la duda entre 'comprobante' y 'meme', si se ve cualquier dato bancario/monto/transferencia es 'comprobante'.",
    },
    title_is_valid: {
      type: "boolean",
      description:
        "Solo para kind='titulo': true si parece un título/diploma/certificado profesional GENUINO, O una constancia/certificado de alumno regular EN CURSO, de cosmetología, cosmiatría, dermatocosmiatría, estética o un área afín de la piel/belleza, emitido por una institución o curso. Aceptá tanto a profesionales recibidas como a estudiantes que están cursando una formación del rubro. false si no se puede confirmar que sea un certificado real. Para kind distinto de 'titulo', devolvé false.",
    },
    holder_name: {
      type: ["string", "null"],
      description: "Nombre y apellido de la persona titular del certificado, si se lee.",
    },
    title_name: {
      type: ["string", "null"],
      description: "Nombre del título o certificación (ej. 'Técnica en Cosmetología', 'Curso de Dermaplaning').",
    },
    institution: {
      type: ["string", "null"],
      description: "Institución, academia o profesional que emite el certificado.",
    },
    confidence: {
      type: "string",
      enum: ["alta", "media", "baja"],
      description: "Confianza global en la clasificación y, si aplica, en la validez del título.",
    },
    note: {
      type: ["string", "null"],
      description: "Una frase corta explicando el veredicto (qué se vio, por qué es o no un título válido).",
    },
  },
  required: [
    "kind",
    "title_is_valid",
    "holder_name",
    "title_name",
    "institution",
    "confidence",
    "note",
  ],
} as const;

const SYSTEM_PROMPT = [
  "Sos un clasificador de imágenes para una formación profesional en estética.",
  "Recibís un adjunto que mandó una persona y tenés que decidir si es:",
  "un comprobante de pago bancario, un título/certificado profesional, un meme",
  "(GIF, sticker, imagen de reacción o broma), u otra cosa. Las profesionales",
  "mandan seguido memes o GIFs de reacción (ej. una famosa reaccionando): eso es",
  "'meme', NO un comprobante ni un título. Solo es 'comprobante' si se ve un pago",
  "real (monto, banco, transferencia); solo es 'titulo' si se ve un certificado real.",
  "Si es un título, validá que sea un certificado GENUINO de cosmetología,",
  "cosmiatría, dermatocosmiatría, estética o un área afín. Sé razonable: aceptá",
  "diplomas y certificados de cursos del rubro, aunque sean de distintas",
  "instituciones. Aceptá también las CONSTANCIAS o CERTIFICADOS de alumno",
  "regular / en curso de una formación del rubro: vale tanto la profesional ya",
  "recibida como la estudiante que está cursando. Rechazá (title_is_valid=false)",
  "si es una foto cualquiera, un documento no relacionado, o algo ilegible que",
  "no puedas confirmar como título o constancia de estudios del rubro.",
  "No inventes datos: lo que no leas con seguridad va en null.",
].join(" ");

/**
 * Clasifica un adjunto y, si es un título, lo valida. Devuelve null si la
 * llamada a vision falla (el caller decide el fallback).
 */
export async function classifyAttachment(args: {
  bytes: Buffer;
  contentType: string;
}): Promise<AttachmentClassification | null> {
  const model = serverEnv().ANTHROPIC_MODEL_VISION;
  const base64 = args.bytes.toString("base64");

  const mediaBlock =
    args.contentType === "application/pdf"
      ? ({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        } as const)
      : ({
          type: "image",
          source: {
            type: "base64",
            media_type: args.contentType as
              | "image/jpeg"
              | "image/png"
              | "image/webp"
              | "image/gif",
            data: base64,
          },
        } as const);

  try {
    const response = await getAnthropicClient().messages.create({
      model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            mediaBlock,
            { type: "text", text: "Clasificá esta imagen y, si es un título, validalo." },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return JSON.parse(textBlock.text) as AttachmentClassification;
  } catch (err) {
    console.error("[titles] falló la clasificación con vision:", err);
    return null;
  }
}
