import type { Metadata } from "next";
import { SupplyContracts } from "@/components/supply-contracts";

export const metadata: Metadata = {
  title: "供应订单",
  description: "查看资源预留、开通、计量、结算和清理状态。",
};

export default function SupplyOrdersPage() {
  return <SupplyContracts />;
}
