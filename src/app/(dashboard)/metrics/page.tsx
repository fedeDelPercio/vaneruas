import { MetricsDashboard } from "@/components/MetricsDashboard";

export const dynamic = "force-dynamic";

export default function MetricsPage() {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <MetricsDashboard />
    </div>
  );
}
