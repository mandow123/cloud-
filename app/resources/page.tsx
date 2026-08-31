import type { Metadata } from "next";
import { Suspense } from "react";
import { ResourceExplorer } from "@/components/resource-explorer";
import { classifyBuyCatalogListing } from "@/lib/buy-catalog";
import { resourceListings, suppliers } from "@/lib/data";
import type { Locale } from "@/lib/i18n";
import { isBuyCatalogV2Enabled } from "@/lib/server/buy-catalog-feature";
import { manualDeliveryIntakeEnabled } from "@/lib/server/manual-delivery-intake";
import { getRequestLocale } from "@/lib/server/request-locale";

const RESOURCES_PAGE_COPY = {
  "zh-CN": { title: "算力资源市场", description: "筛选并比较 GPU、Token、模型、整机柜容量与云厂商资源。", fallback: "正在读取资源筛选条件…" },
  "zh-TW": { title: "算力資源市場", description: "篩選並比較 GPU、Token、模型、整機櫃容量與雲端供應商資源。", fallback: "正在讀取資源篩選條件…" },
  en: { title: "Compute Resource Marketplace", description: "Filter and compare GPU, Token, model, rack-capacity, and cloud-provider resources.", fallback: "Loading resource filters…" },
  ja: { title: "コンピュートリソース市場", description: "GPU、Token、モデル、ラック容量、クラウド事業者のリソースを絞り込み、比較できます。", fallback: "リソースの絞り込み条件を読み込んでいます…" },
  ko: { title: "컴퓨팅 리소스 시장", description: "GPU, Token, 모델, 랙 용량 및 클라우드 공급자 리소스를 필터링하고 비교합니다.", fallback: "리소스 필터를 불러오는 중…" },
  fr: { title: "Marché des ressources de calcul", description: "Filtrez et comparez les GPU, Token, modèles, capacités de baie et ressources cloud.", fallback: "Chargement des filtres de ressources…" },
  th: { title: "ตลาดทรัพยากรประมวลผล", description: "กรองและเปรียบเทียบ GPU, Token, โมเดล, ความจุแร็ก และทรัพยากรจากผู้ให้บริการคลาวด์", fallback: "กำลังโหลดตัวกรองทรัพยากร…" },
  vi: { title: "Chợ tài nguyên tính toán", description: "Lọc và so sánh GPU, Token, mô hình, dung lượng tủ rack và tài nguyên nhà cung cấp đám mây.", fallback: "Đang tải bộ lọc tài nguyên…" },
  id: { title: "Pasar Sumber Daya Komputasi", description: "Filter dan bandingkan GPU, Token, model, kapasitas rak, dan sumber daya penyedia cloud.", fallback: "Memuat filter sumber daya…" },
  ms: { title: "Pasaran Sumber Pengkomputeran", description: "Tapis dan bandingkan GPU, Token, model, kapasiti rak dan sumber penyedia awan.", fallback: "Memuatkan penapis sumber…" },
} satisfies Record<Locale, { title: string; description: string; fallback: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const copy = RESOURCES_PAGE_COPY[locale];
  return { title: copy.title, description: copy.description };
}

function ResourceExplorerFallback({ label }: { label: string }) {
  return (
    <div className="shell py-24" role="status">
      <div className="border-y border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
        <p className="m-0 text-sm font-semibold text-[var(--ink)]">{label}</p>
      </div>
    </div>
  );
}

export default async function ResourcesPage() {
  const locale = await getRequestLocale();
  const classifications = Object.fromEntries(resourceListings.map((listing) => [listing.id, classifyBuyCatalogListing(listing, suppliers)]));
  return (
    <Suspense fallback={<ResourceExplorerFallback label={RESOURCES_PAGE_COPY[locale].fallback} />}>
      <ResourceExplorer classifications={classifications} inquiryEnabled={isBuyCatalogV2Enabled() && manualDeliveryIntakeEnabled()} listings={resourceListings} />
    </Suspense>
  );
}
