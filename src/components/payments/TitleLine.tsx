import { interventionCategoryLabel, urgentIntervention } from "@/lib/intervention-category";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { titleChips } from "@/lib/payments/revision-card";

const tones = {
  ok: "border-ok/30 text-emerald-700 dark:text-ok",
  warn: "border-warn/30 text-amber-700 dark:text-warn",
  bad: "border-red-600/30 text-red-700 dark:text-red-300",
  neutral: "border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300",
};

export function CardChip({ tone, children }: { tone: keyof typeof tones; children: ReactNode }) {
  return <span className={`badge-pill inline-flex items-center gap-1 ${tones[tone]}`}>{children}</span>;
}

export function InterventionChip({ category }: { category: string }) {
  return (
    <CardChip tone={urgentIntervention(category) ? "bad" : "warn"}>
      {interventionCategoryLabel(category) || "Intervención abierta"}
    </CardChip>
  );
}

export function TitleLine({ state, awaitingTitle, children }: {
  state: keyof typeof titleChips;
  awaitingTitle?: boolean;
  children?: ReactNode;
}) {
  const chip = titleChips[state];
  return (
    <div className="border-t border-neutral-200 pt-2.5 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13px] font-medium">Título profesional</span>
        <CardChip tone={chip.tone}>
          {(state === "valid" || state === "exempt") && <Check className="h-3 w-3" strokeWidth={2} />}
          {chip.label}
        </CardChip>
        {awaitingTitle && <span className="text-[11px] text-neutral-600 dark:text-neutral-400">Pago retenido hasta validar el título</span>}
      </div>
      {"detail" in chip && (
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">{chip.detail}</p>
      )}
      {children}
    </div>
  );
}
