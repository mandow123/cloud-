import type { Metadata } from "next";
import { SupplyResourceDetail } from "@/components/supply-resource-detail";
import { requireSupplyHostingPageAccess } from "@/lib/server/account-console-page-gate";

export const metadata: Metadata = {
  title: "设备详情",
  description: "查看 Host Agent 状态、签名硬件清单和验真记录。",
};

export default async function SupplyDeviceDetailPage({ params }: { params: Promise<{ deviceId: string }> }) {
  requireSupplyHostingPageAccess();
  const { deviceId } = await params;
  return <SupplyResourceDetail deviceId={deviceId} />;
}
