import { PaymentsList } from "@/components/PaymentsList";

export const dynamic = "force-dynamic";

export default function PaymentsPage() {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PaymentsList />
    </div>
  );
}
