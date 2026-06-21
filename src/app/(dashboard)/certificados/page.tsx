import { CertificadosList } from "@/components/CertificadosList";

export const dynamic = "force-dynamic";

export default function CertificadosPage() {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <CertificadosList />
    </div>
  );
}
