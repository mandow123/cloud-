import type { Metadata } from "next";
import { SupplierExchangeWorkspace } from "@/components/supplier-exchange-workspace";
import { SupplierOrderQueue } from "@/components/supplier-order-queue";

export const metadata: Metadata = {
  title: "供应商容量工作台",
  description: "登记可交付资源、发布容量报价并处理采购订单。",
};

export default function SupplierWorkspacePage() {
  return (
    <div className="shell space-y-14 py-10 sm:py-14">
      <SupplierExchangeWorkspace />
      <SupplierOrderQueue />
    </div>
  );
}
