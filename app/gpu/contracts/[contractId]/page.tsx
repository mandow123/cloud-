import type { Metadata } from "next";
import { HostingContractWorkspace } from "@/components/hosting-contract-workspace";

export const metadata: Metadata = {
  title: "GPU 租赁工作台",
  description: "完成 SSH 开通、实例启停、计量验收和清理。",
};

export default async function HostingContractPage({ params }: { params: Promise<{ contractId: string }> }) {
  const { contractId } = await params;
  return <HostingContractWorkspace contractId={contractId} />;
}
