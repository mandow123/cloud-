import type { Metadata } from "next";
import { LiveModelPriceBoard } from "@/components/live-model-price-board";
import { MarketDashboard } from "@/components/market-dashboard";
import type { ModelCostIndexSnapshot, ModelTokenPriceQuote } from "@/components/model-price-board";
import { marketSeries } from "@/lib/data";
import type { Locale } from "@/lib/i18n";
import { readMarketSnapshot } from "@/lib/server/market-snapshot";
import { getRequestLocale } from "@/lib/server/request-locale";

const metadataCopy = {
  "zh-CN": ["算力与模型行情中心", "查看每日更新的主流模型 Token 分项目录价，以及 GPU、整机柜容量和云厂商资源的市场价格分位与趋势。"],
  "zh-TW": ["算力與模型行情中心", "查看每日更新的主流模型 Token 分項目錄價，以及 GPU、整機櫃容量和雲端供應商資源的價格分位與趨勢。"],
  en: ["Compute and model market", "View daily model Token catalog prices and market percentiles for GPU, rack capacity, and cloud resources."],
  ja: ["算力・モデル市場", "モデル Token の日次価格と GPU、ラック容量、クラウド資源の市場分位・推移を確認します。"],
  ko: ["컴퓨팅 및 모델 시장", "모델 Token 일일 가격과 GPU, 랙 용량, 클라우드 리소스의 시장 분위 및 추세를 확인합니다."],
  fr: ["Marché du calcul et des modèles", "Consultez les prix Token quotidiens et les percentiles de marché des GPU, racks et ressources cloud."],
  th: ["ตลาดพลังประมวลผลและโมเดล", "ดูราคา Token รายวันและเปอร์เซ็นไทล์ตลาดของ GPU แร็ก และทรัพยากรคลาวด์"],
  vi: ["Thị trường năng lực và mô hình", "Xem giá Token hằng ngày và phân vị thị trường của GPU, tủ máy và tài nguyên đám mây."],
  id: ["Pasar komputasi dan model", "Lihat harga Token harian dan persentil pasar GPU, rak, serta sumber daya cloud."],
  ms: ["Pasaran pengkomputeran dan model", "Lihat harga Token harian dan persentil pasaran GPU, rak serta sumber awan."],
} as const satisfies Record<Locale, readonly [string, string]>;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: metadataCopy[locale][0], description: metadataCopy[locale][1] };
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
