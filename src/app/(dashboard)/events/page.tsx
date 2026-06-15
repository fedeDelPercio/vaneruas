import { EventsManager } from "@/components/EventsManager";

export const dynamic = "force-dynamic";

export default function EventsPage() {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <EventsManager />
    </div>
  );
}
