import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import { enrollmentPendingPaymentId } from "./messages";

type Notification = { reason: string | null; resolved_at: string | null };

// El acceso registrado prevalece sobre un aviso histórico abierto. Esta
// proyección se usa en las listas y los contadores, sin escribir en la base.
export async function withoutStaleEnrollmentNotifications<T extends Notification>(
  sb: SupabaseClient<Database>,
  rows: readonly T[],
): Promise<T[]> {
  const paymentId = (row: T) => row.resolved_at ? null : enrollmentPendingPaymentId(row.reason);
  const ids = [...new Set(rows.map(paymentId).filter((id): id is string =>
    Boolean(id && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)),
  ))];
  const granted = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from("payment_validations")
      .select("id")
      .in("id", ids.slice(i, i + 100))
      .not("course_access_granted_at", "is", null);
    if (error) throw error;
    for (const row of data ?? []) granted.add(row.id);
  }
  return rows.filter((row) => !granted.has(paymentId(row) ?? ""));
}
