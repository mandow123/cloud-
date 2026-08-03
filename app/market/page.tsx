import type { Metadata } from "next";
import { LiveModelPriceBoard } from "@/components/live-model-price-board";
import { MarketDashboard } from "@/components/market-dashboard";
import type { ModelCostIndexSnapshot, ModelTokenPriceQuote } from "@/components/model-price-board";
import modelMarketSnapshot from "@/data/model-market.snapshot.json";
import { marketSeries } from "@/lib/data";

export const metadata: Metadata = {
  title: "算力与模型行情中心",
  description: "查看每日更新的主流模型 Token 分项目录价，以及 GPU、整机柜容量和云厂商资源的演示价格分位与趋势。",
};

export default function MarketPage() {
  const infrastructureSeries = marketSeries.filter((series) => series.category !== "token_model");

  return (
    <MarketDashboard
      series={infrastructureSeries}
      modelBoard={
        <LiveModelPriceBoard
          initialSnapshot={{
            quotes: modelMarketSnapshot.quotes as ModelTokenPriceQuote[],
            index: modelMarketSnapshot.index as ModelCostIndexSnapshot,
            publishedAt: modelMarketSnapshot.publishedAt,
          }}
        />
      }
    />
  );
}
