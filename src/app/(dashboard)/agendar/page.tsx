import { AgendarList } from "@/components/AgendarList";

export const dynamic = "force-dynamic";

export default function AgendarPage() {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <AgendarList />
    </div>
  );
}
