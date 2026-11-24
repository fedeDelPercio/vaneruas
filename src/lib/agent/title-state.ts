type Title = { file_path: string | null; is_valid: boolean; reviewed_at: string | null };

export function professionalTitleState(titles: readonly Title[], registered: boolean, awaitingTitle: boolean) {
  const files = titles.filter((title) => title.file_path);
  if (files.some((title) => title.is_valid)) return "validado";
  if (registered && !awaitingTitle) return "exento";
  if (files.some((title) => !title.reviewed_at)) return "revision";
  if (files.some((title) => title.reviewed_at)) return "rechazado";
  return "no_recibido";
}

type TitleState = ReturnType<typeof professionalTitleState>;

export function professionalTitleLine(state: TitleState, awaitingTitle = false): string {
  const labels: Record<TitleState, string> = {
    validado: "VALIDADO",
    exento: "NO HACE FALTA (ya registrada)",
    revision: "EN REVISIÓN (mandó un archivo, lo revisa el equipo)",
    rechazado: "RECHAZADO",
    no_recibido: "NO RECIBIDO (no mandó ningún archivo; un texto describiendo su formación no cuenta)",
  };
  return `Título profesional: ${labels[state]}${awaitingTitle ? "\nPago: comprobante retenido, pendiente de título y sin aprobación" : ""}`;
}

export function titleClaimFeedback(reply: string, state: TitleState): string | null {
  if (state === "validado") return null;
  const claim = /t[ií]tulo(?:\s+profesional)?\s+(?:(?:de [^.!?\n§]{1,30}?\s+)?(?:ya\s+)?(?:qued[oó]|queda|est[aá]|fue|ha sido|lo dimos por)\s+)?(?:validado|aprobado|aceptado)\b|\b(?:valid[eé]|aprob[eé]|acept[eé]|validamos|aprobamos|aceptamos|se valid[oó]|se aprob[oó]|se acept[oó])\s+(?:ya\s+)?(?:tu|el)\s+t[ií]tulo\b/i;
  const sentences = reply.replace(/[*_]/g, "").replace(/\b(?:no|todav[ií]a no|a[uú]n no)\s+(?=\w)/gi, "§");
  for (const match of sentences.matchAll(new RegExp(claim.source, "gi"))) {
    if (sentences[(match.index ?? 0) - 1] === "§") continue;
    return "No digas que el título está validado: el sistema no lo validó. Si falta el archivo, pedile la foto o el PDF";
  }
  return null;
}
