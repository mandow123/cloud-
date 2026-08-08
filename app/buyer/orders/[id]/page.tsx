import type { Metadata } from "next";
import { OrderDetail } from "@/components/order-detail";

export const metadata: Metadata = {
  title: "采购订单详情",
  description: "查看订单支付、交付、计量和验收状态。",
};

type BuyerOrderPageProps = {
  params: Promise<{ id: string }>;
};

export default async function BuyerOrderPage({ params }: BuyerOrderPageProps) {
  const { id } = await params;
  return (
    <div className="shell py-10 sm:py-14">
      <OrderDetail orderId={id} role="buyer" />
    </div>
  );
}
