import type { Metadata } from "next";
import { BuyerOrderList } from "@/components/buyer-order-list";

export const metadata: Metadata = {
  title: "我的采购订单",
  description: "查看资源锁定、供应商确认、支付、交付、计量与验收进度。",
};

export default function BuyerOrdersPage() {
  return (
    <div className="shell py-10 sm:py-14">
      <BuyerOrderList />
    </div>
  );
}
