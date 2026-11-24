const CATEGORY_LABELS: Record<string, string> = {
  fuera_de_conocimiento: "Fuera de conocimiento",
  escalado_manual: "Escalado manual",
  reclamo_certificado: "Reclamo de certificado",
  cliente_existente: "Cliente existente",
  interes_compra: "Interés de compra",
  falla_tecnica: "Falla técnica",
};

export function interventionCategoryLabel(category: string) {
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, " ").trim();
}

export function urgentIntervention(category: string) {
  return category === "escalado_manual" || category.startsWith("reclamo");
}
