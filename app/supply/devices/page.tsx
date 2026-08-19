import type { Metadata } from "next";
import { SupplyResources } from "@/components/supply-resources";
import { requireSupplyHostingPageAccess } from "@/lib/server/account-console-page-gate";

export const metadata: Metadata = {
  title: "托管设备",
  description: "查看托管设备的运营、部署、待办、离线和停用状态。",
};

export default function SupplyDevicesPage() {
  requireSupplyHostingPageAccess();
  return <SupplyResources />;
}
