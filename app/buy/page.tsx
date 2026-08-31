import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BuyWorkspace } from "@/components/buy-workspace";
import { partitionBuyCatalog } from "@/lib/buy-catalog";
import { resourceListings, suppliers } from "@/lib/data";
import { isBuyCatalogV2Enabled } from "@/lib/server/buy-catalog-feature";
import { manualDeliveryIntakeEnabled } from "@/lib/server/manual-delivery-intake";
import { getRequestLocale } from "@/lib/server/request-locale";

const metadataCopy = {
  "zh-CN": ["选购 GPU 算力", "查看供应商 GPU 套餐、规格与卡时参考价，登录后提交询价。"],
  "zh-TW": ["選購 GPU 算力", "查看供應商 GPU 套餐、規格與卡時參考價，登入後提交詢價。"],
  en: ["Buy GPU compute", "Compare supplier GPU packages, specifications and card-hour reference prices, then sign in to request a quote."],
  ja: ["GPU コンピュートを購入", "サプライヤーの GPU パッケージ、仕様、カード時の参考価格を比較し、ログインして見積もりを依頼できます。"],
  ko: ["GPU 컴퓨팅 구매", "공급업체 GPU 패키지, 사양 및 카드시간 참고 가격을 비교한 뒤 로그인하여 견적을 요청하세요."],
  fr: ["Acheter du calcul GPU", "Comparez les offres GPU, les spécifications et les prix indicatifs en heures-carte, puis connectez-vous pour demander un devis."],
  th: ["ซื้อพลังประมวลผล GPU", "เปรียบเทียบแพ็กเกจ GPU ข้อมูลจำเพาะ และราคาอ้างอิงชั่วโมงการ์ด แล้วเข้าสู่ระบบเพื่อขอใบเสนอราคา"],
  vi: ["Mua năng lực GPU", "So sánh gói GPU, thông số và giá tham khảo theo giờ-thẻ, sau đó đăng nhập để yêu cầu báo giá."],
  id: ["Beli komputasi GPU", "Bandingkan paket GPU, spesifikasi, dan harga referensi jam-kartu, lalu masuk untuk meminta penawaran."],
  ms: ["Beli pengkomputeran GPU", "Bandingkan pakej GPU, spesifikasi dan harga rujukan jam-kad, kemudian log masuk untuk meminta sebut harga."],
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
