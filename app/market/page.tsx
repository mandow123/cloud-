import type { Metadata } from "next";
import { LiveModelPriceBoard } from "@/components/live-model-price-board";
import { MarketDashboard } from "@/components/market-dashboard";
import type { ModelCostIndexSnapshot, ModelTokenPriceQuote } from "@/components/model-price-board";
import { marketSeries } from "@/lib/data";
import { readMarketSnapshot } from "@/lib/server/market-snapshot";

export const metadata: Metadata = {
  title: "算力与模型行情中心",
  description: "查看每日更新的主流模型 Token 公开目录价，以及基础设施历史样本的价格分位与趋势；不代表可购买库存。",
};

export default async function MarketPage() {
  const infrastructureSeries = marketSeries.filter((series) => series.category !== "token_model");
  const { snapshot, source } = await readMarketSnapshot();

  return (
    <MarketDashboard
      series={infrastructureSeries}
      modelBoard={
        <LiveModelPriceBoard
          initialSource={source}
          initialSnapshot={{
            quotes: snapshot.quotes as ModelTokenPriceQuote[],
            index: snapshot.index as ModelCostIndexSnapshot,
            publishedAt: snapshot.publishedAt,
          }}
        />
      }
    />
  );
}
