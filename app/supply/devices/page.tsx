import type { Metadata } from "next";
import { SupplyResources } from "@/components/supply-resources";

export const metadata: Metadata = {
  title: "托管设备",
  description: "查看托管设备的运营、部署、待办、离线和停用状态。",
};

export default function SupplyDevicesPage() {
  return <SupplyResources />;
}
