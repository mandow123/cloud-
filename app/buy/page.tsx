import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BuyWorkspace } from "@/components/buy-workspace";
import { partitionBuyCatalog } from "@/lib/buy-catalog";
import { resourceListings, suppliers } from "@/lib/data";
import { isBuyCatalogV2Enabled } from "@/lib/server/buy-catalog-feature";
import { manualDeliveryIntakeEnabled } from "@/lib/server/manual-delivery-intake";
import { getRequestLocale } from "@/lib/server/request-locale";

const metadataCopy = {
  "zh-CN": ["选购 GPU", "租用 GPU 算力，或购买独立确权的实体 GPU 并选择云托管。"],
  "zh-TW": ["選購 GPU", "租用 GPU 算力，或購買獨立確權的實體 GPU 並選擇雲端託管。"],
  en: ["Buy GPU compute", "Rent GPU compute or purchase a separately owned physical GPU and choose managed hosting."],
  ja: ["GPU コンピュートを購入", "GPU コンピュートをレンタルするか、個別所有の物理 GPU を購入してクラウド運用を選択します。"],
  ko: ["GPU 컴퓨팅 구매", "GPU 컴퓨팅을 대여하거나 독립 소유권의 물리 GPU를 구매해 클라우드 호스팅을 선택하세요."],
  fr: ["Acheter du calcul GPU", "Louez du calcul GPU ou achetez un GPU physique détenu séparément avec hébergement géré."],
  th: ["ซื้อพลังประมวลผล GPU", "เช่าพลังประมวลผล GPU หรือซื้อ GPU จริงที่มีกรรมสิทธิ์แยกและเลือกบริการโฮสต์"],
  vi: ["Mua năng lực GPU", "Thuê năng lực GPU hoặc mua GPU vật lý có quyền sở hữu riêng và chọn dịch vụ lưu trữ."],
  id: ["Beli komputasi GPU", "Sewa komputasi GPU atau beli GPU fisik dengan kepemilikan terpisah dan pilih hosting terkelola."],
  ms: ["Beli pengkomputeran GPU", "Sewa pengkomputeran GPU atau beli GPU fizikal dengan pemilikan berasingan dan pilih pengehosan terurus."],
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const [title, description] = metadataCopy[await getRequestLocale()];
  return { title, description };
}

export default function BuyPage() {
  if (!isBuyCatalogV2Enabled()) redirect("/gpu");
  const catalog = partitionBuyCatalog(resourceListings, suppliers);
  return <BuyWorkspace inquiryEnabled={manualDeliveryIntakeEnabled()} primaryListings={catalog.primary} referenceLeads={catalog.referenceLeads} showLiveInventory />;
}
