import type { Metadata } from "next";
import { SupplyDashboard } from "@/components/supply-dashboard";

export const metadata: Metadata = {
  title: "供应概览",
  description: "查看当前供应主体的设备、挂牌、订单、收益和成交就绪状态。",
};

export default function SupplyPage() {
  return <SupplyDashboard />;
}
