import type { Metadata } from "next";
import { SupplyEarnings } from "@/components/supply-earnings";

export const metadata: Metadata = {
  title: "卡时收益",
  description: "查看租金、佣金、可用 KAI 标准卡时和不可变账本明细。",
};

export default function SupplyEarningsPage() {
  return <SupplyEarnings />;
}
