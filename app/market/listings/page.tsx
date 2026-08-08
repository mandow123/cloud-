import type { Metadata } from "next";
import { LiveExchangeMarket } from "@/components/live-exchange-market";

export const metadata: Metadata = {
  title: "可购买算力资源",
  description: "查看已核验、报价有效且容量时间窗连续的在售资源，并进入下单流程。",
};

export default function MarketListingsPage() {
  return <LiveExchangeMarket />;
}
