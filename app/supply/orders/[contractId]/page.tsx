import type { Metadata } from "next";
import { SupplyContractDetail } from "@/components/supply-contract-detail";
import { requireSupplyHostingPageAccess } from "@/lib/server/account-console-page-gate";

export const metadata: Metadata = {
  title: "供应订单详情",
  description: "查看 Host Agent 履约、实际计量、验收结算和清理证据状态。",
};

export default async function SupplyOrderDetailPage({ params }: { params: Promise<{ contractId: string }> }) {
  requireSupplyHostingPageAccess();
  const { contractId } = await params;
  return <SupplyContractDetail contractId={contractId} />;
}
