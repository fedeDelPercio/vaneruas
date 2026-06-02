// ===========================================================================
// Rubric del evaluator.
//
// Los criterios estan aca como DATOS estructurados: documentan y permiten
// validar los ids que el evaluator devuelve en `failedCriteria`. El "source
// of truth" del comportamiento evaluativo es `prompts/evaluator.md`; esta
// lista debe mantenerse alineada con ese archivo.
// ===========================================================================

export type CriterionSeverity = "blocker" | "major" | "minor";

export interface RubricCriterion {
  /** Id en snake_case. El evaluator lo usa en failedCriteria. */
  id: string;
  title: string;
  description: string;
  severity: CriterionSeverity;
}

export const RUBRIC: RubricCriterion[] = [
  {
    id: "grounding",
    title: "Grounding / anti-alucinación",
    description:
      "Toda afirmación sobre productos, precios o condiciones debe estar " +
      "respaldada por la base de conocimiento o las instrucciones del asesor.",
    severity: "blocker",
  },
  {
    id: "no_revela_ia",
    title: "No revela que es una IA",
    description:
      "La respuesta no debe decir ni insinuar que el asesor es una IA, un " +
      "bot o un sistema automático.",
    severity: "blocker",
  },
  {
    id: "coherencia",
    title: "Coherencia y tono",
    description:
      "La respuesta atiende lo que el cliente preguntó y mantiene un tono " +
      "cordial y profesional.",
    severity: "major",
  },
];

/** Id especial que el evaluator usa cuando su propia salida no es JSON válido. */
export const MALFORMED_OUTPUT_ID = "malformed_output";

/** Ids válidos de criterios. */
export const RUBRIC_CRITERION_IDS: string[] = RUBRIC.map((c) => c.id);
