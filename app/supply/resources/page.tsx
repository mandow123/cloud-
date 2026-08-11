import type { Metadata } from "next";
import { SupplyResources } from "@/components/supply-resources";

export const metadata: Metadata = {
  title: "资源与设备",
  description: "查看当前供应主体的设备、Agent 状态和验真有效期。",
};

export default function SupplyResourcesPage() {
  return <SupplyResources />;
}
