import "server-only";

import { getAnthropicClient } from "@/lib/agent/llm-client";
import { serverEnv } from "@/lib/env";

// ===========================================================================
// Extractor de comprobantes de pago con Claude vision.
//
// Recibe la imagen (o PDF) del comprobante y devuelve los datos estructurados
// que se puedan leer: quién envía, monto, fecha, N° de operación, banco/medio,
// etc. Todo es opcional: lo que el comprobante no muestre vuelve null. El
// equipo de Vane valida igual manualmente contra su contabilidad, así que el
// OCR es una ayuda, no la fuente de verdad.
// ===========================================================================

export interface PaymentExtraction {
  sender_name: string | null;
  sender_tax_id: string | null;
  recipient_name: string | null;
  recipient_tax_id: string | null;
  amount: number | null;
  currency: string | null;
  transfer_date_raw: string | null;
  transferred_at: string | null; // ISO 8601 si se puede normalizar, si no null
  operation_number: string | null;
  bank_or_method: string | null;
  concept: string | null;
  confidence: "high" | "medium" | "low";
  is_payment_receipt: boolean; // false si la imagen no parece un comprobante
}

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    is_payment_receipt: {
      type: "boolean",
      description:
        "true si la imagen es un comprobante de transferencia o pago, false si es otra cosa (foto cualquiera, captura no relacionada).",
    },
    sender_name: { type: ["string", "null"], description: "Nombre de quien envía el dinero (campo 'De')." },
    sender_tax_id: { type: ["string", "null"], description: "CUIT/CUIL del emisor, tal cual aparece." },
    recipient_name: { type: ["string", "null"], description: "Nombre del destinatario (campo 'Para')." },
    recipient_tax_id: { type: ["string", "null"], description: "CUIT/CUIL del destinatario." },
    amount: { type: ["number", "null"], description: "Monto transferido como número, sin símbolos ni separadores de miles (ej. 232000 para $232.000)." },
    currency: { type: ["string", "null"], description: "Moneda (ej. 'ARS'). Asumir ARS si es un comprobante argentino sin indicación explícita." },
    transfer_date_raw: { type: ["string", "null"], description: "Fecha y hora tal cual figuran en el comprobante (ej. '05/06/2026 14:28 h')." },
    transferred_at: { type: ["string", "null"], description: "Fecha y hora en ISO 8601 (ej. '2026-06-05T14:28:00') si se puede normalizar con confianza, si no null." },
    operation_number: { type: ["string", "null"], description: "Número de operación o de comprobante." },
    bank_or_method: { type: ["string", "null"], description: "Banco o medio de pago (ej. 'Galicia', 'Mercado Pago')." },
    concept: { type: ["string", "null"], description: "Concepto o motivo de la transferencia." },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "Confianza global en la lectura de los datos.",
    },
  },
  required: [
    "is_payment_receipt",
    "sender_name",
    "sender_tax_id",
    "recipient_name",
    "recipient_tax_id",
    "amount",
    "currency",
    "transfer_date_raw",
    "transferred_at",
    "operation_number",
    "bank_or_method",
    "concept",
    "confidence",
  ],
} as const;

const SYSTEM_PROMPT = [
  "Sos un extractor de datos de comprobantes de transferencia bancaria argentinos",
  "(bancos y billeteras como Galicia, Mercado Pago, Brubank, Naranja X, etc.).",
  "Leé la imagen y devolvé únicamente los datos que puedas leer con seguridad.",
  "Si un dato no está o no se lee bien, devolvé null para ese campo, no lo inventes.",
  "El monto va como número puro: para '$232.000' devolvé 232000; para '$ 20.000' devolvé 20000.",
  "Si la imagen no es un comprobante de pago, poné is_payment_receipt en false.",
].join(" ");

/**
 * Corre el OCR de vision sobre el comprobante. Devuelve los datos extraídos, o
 * null si la llamada a la API falla (el caller decide qué hacer: igual se
 * guarda el comprobante para validación manual).
 */
export async function extractPaymentData(args: {
  bytes: Buffer;
  contentType: string;
}): Promise<PaymentExtraction | null> {
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
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      output_config: {
        format: {
          type: "json_schema",
          schema: EXTRACTION_SCHEMA,
        },
      },
      messages: [
        {
          role: "user",
          content: [
            mediaBlock,
            { type: "text", text: "Extraé los datos de este comprobante." },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return JSON.parse(textBlock.text) as PaymentExtraction;
  } catch (err) {
    console.error("[payments] falló la extracción con vision:", err);
    return null;
  }
}
