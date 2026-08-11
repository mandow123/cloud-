import type { Metadata } from "next";
import { SupplyListingsV2 } from "@/components/supply-listings-v2";

export const metadata: Metadata = {
  title: "挂牌管理",
  description: "管理经过验真的 GPU 报价、价格、可用窗口和发布状态。",
};

export default function SupplyListingsPage() {
  return <SupplyListingsV2 />;
}
