import { Check, Clock, X } from "lucide-react";
import type { ReactNode } from "react";
import type { CardStep } from "@/lib/payments/card-steps";

const indicators = {
  done: { Icon: Check, color: "border-ok/40 bg-ok/10 text-emerald-700 dark:text-ok" },
  current: { Icon: Clock, color: "border-warn/40 bg-warn/10 text-amber-800 dark:text-warn" },
  error: { Icon: X, color: "border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300" },
  future: { Icon: null, color: "border-dashed border-neutral-400 dark:border-neutral-600" },
};

export function PaymentStepper({ steps, slots }: {
  steps: CardStep[];
  slots: Partial<Record<CardStep["key"], ReactNode>>;
}) {
  return (
    <ol aria-label="Estado de la inscripción" className="min-w-0">
      {steps.map(({ key, label, status, detail }, index) => {
        const { Icon, color } = indicators[status];
        return (
          <li key={key} data-step={key} data-status={status} aria-current={status === "current" ? "step" : undefined}
            className={`relative flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 ${status === "current" ? "bg-amber-500/[0.07]" : ""}`}>
            {index < steps.length - 1 && <span aria-hidden className="absolute -bottom-1.5 left-5 top-[26px] w-px bg-neutral-200 dark:bg-neutral-700" />}
            <span aria-hidden className={`relative z-[1] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${color}`}>
              {Icon && <Icon className="h-3 w-3" strokeWidth={2} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] font-medium leading-5 ${status === "current" ? "text-amber-900 dark:text-warn" : ""}`}>{label}</p>
              <p className={`text-[11.5px] leading-relaxed ${status === "error" ? "text-red-700 dark:text-red-300" : "text-neutral-600 dark:text-neutral-400"}`}>{detail}</p>
              {slots[key]}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
