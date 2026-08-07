import type { Metadata } from "next";
import { SupplyAssetsDashboard } from "@/components/supply-assets-dashboard";

export const metadata: Metadata = {
  title: "供应资源资产",
  description: "查看已入库资源池、设备成员数量与平台验真状态。",
};

export default function SupplyAssetsPage() {
  return <SupplyAssetsDashboard />;
}
