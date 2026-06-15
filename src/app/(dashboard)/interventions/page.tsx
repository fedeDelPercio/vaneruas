import { InterventionsList } from "@/components/InterventionsList";

export const dynamic = "force-dynamic";

export default function InterventionsPage() {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <InterventionsList />
    </div>
  );
}
