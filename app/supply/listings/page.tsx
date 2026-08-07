import type { Metadata } from "next";
import { SupplyListingsDashboard } from "@/components/supply-listings-dashboard";

export const metadata: Metadata = {
  title: "供应上架计划",
  description: "查看 H100 发布计划、验真安全门和供应订单状态。",
};

export default function SupplyListingsPage() {
  return <SupplyListingsDashboard />;
}
