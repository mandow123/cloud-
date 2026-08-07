import type { Metadata } from "next";
import { SupplyOrderWorkspace } from "@/components/supply-order-workspace";

export const metadata: Metadata = {
  title: "供应订单",
  description: "查看 H100 试运行订单、支付、容量与交付状态。",
};

export default async function SupplyOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  return <SupplyOrderWorkspace orderId={id} role={query.role === "buyer" ? "buyer" : "supplier"} />;
}
