import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { OrderDetail } from "@/components/order-detail";

export const metadata: Metadata = {
  title: "采购订单",
  description: "查看采购订单的供应确认、交付、计量和验收状态。",
};

export default async function BuyerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="shell py-10 sm:py-14">
      <AccountRequired purpose="查看采购订单">
        <OrderDetail orderId={id} role="buyer" />
      </AccountRequired>
    </div>
  );
}
