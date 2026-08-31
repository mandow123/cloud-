import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogPurchase } from "@/components/catalog-purchase";
import { getResourceById, suppliers } from "@/lib/data";
import { isPrimaryInquiryListing } from "@/lib/buy-catalog";
import type { Locale } from "@/lib/i18n";
import { manualDeliveryIntakeEnabled } from "@/lib/server/manual-delivery-intake";
import { isBuyCatalogV2Enabled } from "@/lib/server/buy-catalog-feature";
import { getRequestLocale } from "@/lib/server/request-locale";

type PurchasePageProps = {
  params: Promise<{ resourceId: string }>;
};

const CHECKOUT_METADATA_COPY = {
  "zh-CN": { inquiry: "询价", description: "查看 {title} 的目录参考价并提交询价意向。", missing: "目录资源不存在" },
  "zh-TW": { inquiry: "詢價", description: "查看 {title} 的目錄參考價並提交詢價意向。", missing: "目錄資源不存在" },
  en: { inquiry: "Inquiry", description: "Review the catalog reference for {title} and submit an inquiry.", missing: "Catalog resource not found" },
  ja: { inquiry: "問い合わせ", description: "{title} のカタログ参考価格を確認し、問い合わせを送信します。", missing: "カタログリソースが見つかりません" },
  ko: { inquiry: "문의", description: "{title}의 카탈로그 참고 가격을 확인하고 문의를 제출합니다.", missing: "카탈로그 리소스가 없습니다" },
  fr: { inquiry: "Demande de devis", description: "Consultez le prix catalogue indicatif de {title} et envoyez une demande.", missing: "Ressource catalogue introuvable" },
  th: { inquiry: "สอบถามราคา", description: "ดูราคาอ้างอิงในแค็ตตาล็อกของ {title} และส่งคำขอราคา", missing: "ไม่พบทรัพยากรในแค็ตตาล็อก" },
  vi: { inquiry: "Hỏi giá", description: "Xem giá danh mục tham khảo của {title} và gửi yêu cầu giá.", missing: "Không tìm thấy tài nguyên danh mục" },
  id: { inquiry: "Permintaan penawaran", description: "Lihat referensi katalog {title} dan ajukan permintaan penawaran.", missing: "Sumber daya katalog tidak ditemukan" },
  ms: { inquiry: "Pertanyaan sebut harga", description: "Lihat rujukan katalog {title} dan hantar pertanyaan.", missing: "Sumber katalog tidak ditemui" },
} satisfies Record<Locale, { inquiry: string; description: string; missing: string }>;

export async function generateMetadata({ params }: PurchasePageProps): Promise<Metadata> {
  const locale = await getRequestLocale();
  const copy = CHECKOUT_METADATA_COPY[locale];
  const { resourceId } = await params;
  const resource = getResourceById(resourceId);
  return resource && isBuyCatalogV2Enabled() && isPrimaryInquiryListing(resource, suppliers) && manualDeliveryIntakeEnabled()
    ? { title: `${copy.inquiry} ${resource.title}`, description: copy.description.replace("{title}", resource.title) }
    : { title: copy.missing };
}

export default async function PurchasePage({ params }: PurchasePageProps) {
  const { resourceId } = await params;
  const resource = getResourceById(resourceId);
  const manualDeliveryEnabled = manualDeliveryIntakeEnabled();
  if (!resource || !isBuyCatalogV2Enabled() || !manualDeliveryEnabled || !isPrimaryInquiryListing(resource, suppliers)) notFound();
  return <CatalogPurchase manualDeliveryEnabled={manualDeliveryEnabled} resource={resource} />;
}
