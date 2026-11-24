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

export function TitleLine({ state, children }: { state: keyof typeof titleChips; children?: ReactNode }) {
  const chip = titleChips[state];
  return (
    <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-medium">Título profesional</span>
        <CardChip tone={chip.tone}>
          {(state === "valid" || state === "exempt") && <Check className="h-3 w-3" strokeWidth={2} />}
          {chip.label}
        </CardChip>
      </div>
      {"detail" in chip && (
        <p className="mt-1 text-right text-[11px] text-neutral-500 dark:text-neutral-400">{chip.detail}</p>
      )}
      {children}
    </div>
  );
}
