import type { Metadata } from "next";
import { MarketDashboard } from "@/components/market-dashboard";
import { marketSeries } from "@/lib/data";

export const metadata: Metadata = {
  title: "算力行情中心",
  description: "查看 GPU、Token 与模型、整机柜容量及云厂商资源的演示价格分位与趋势。",
};

export default function MarketPage() {
  return <MarketDashboard series={marketSeries} />;
}
