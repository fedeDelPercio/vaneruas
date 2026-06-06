import { FeedbackList } from "@/components/FeedbackList";

export const dynamic = "force-dynamic";

export default function FeedbackPage() {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <FeedbackList />
    </div>
  );
}
