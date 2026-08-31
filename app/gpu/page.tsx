import type { Metadata } from "next";
import { Suspense } from "react";
import { HostingGpuMarketplace } from "@/components/hosting-gpu-marketplace";
import { ResourceExplorer } from "@/components/resource-explorer";
import { classifyBuyCatalogListing, partitionBuyCatalog } from "@/lib/buy-catalog";
import { resourceListings, suppliers } from "@/lib/data";
import type { Locale } from "@/lib/i18n";
import { isBuyCatalogV2Enabled } from "@/lib/server/buy-catalog-feature";
import { isHostingV2Enabled } from "@/lib/server/hosting-v2-feature";
import { requireHostingV2TransactionCapability } from "@/lib/server/hosting-v2-transaction-gate";
import { manualDeliveryIntakeEnabled } from "@/lib/server/manual-delivery-intake";
import { getRequestLocale } from "@/lib/server/request-locale";

type GpuPageCopy = {
  metadataTitle: string;
  metadataDescription: string;
  fallback: string;
  heading: string;
  lead: string;
};

const GPU_PAGE_COPY: Record<Locale, GpuPageCopy> = {
  "zh-CN": { metadataTitle: "GPU 算力目录", metadataDescription: "查看供应商 GPU 报价，登录后提交询价与人工交付申请。", fallback: "正在读取 GPU 供应商报价…", heading: "供应商 GPU 套餐", lead: "查看供应商、GPU 规格和卡时参考价；选择套餐后提交询价，由平台确认库存、地域网络和人工交付条件。" },
  "zh-TW": { metadataTitle: "GPU 算力目錄", metadataDescription: "查看供應商 GPU 報價，登入後提交詢價與人工交付申請。", fallback: "正在讀取 GPU 供應商報價…", heading: "供應商 GPU 套餐", lead: "查看供應商、GPU 規格和卡時參考價；選擇套餐後提交詢價，由平台確認庫存、區域網路和人工交付條件。" },
  en: { metadataTitle: "GPU Compute Directory", metadataDescription: "Review supplier GPU quotes, then sign in to submit an inquiry and request manual delivery.", fallback: "Loading supplier GPU quotes…", heading: "Supplier GPU packages", lead: "Review suppliers, GPU specifications, and card-hour reference prices. Submit an inquiry for the platform to confirm inventory, regional networking, and manual delivery terms." },
  ja: { metadataTitle: "GPU 計算資源カタログ", metadataDescription: "供給者の GPU 価格を確認し、ログイン後に問い合わせと手動納品を申請できます。", fallback: "供給者の GPU 価格を読み込み中…", heading: "供給者 GPU パッケージ", lead: "供給者、GPU 仕様、カード時の参考価格を確認できます。パッケージを選んで問い合わせを送信すると、在庫、地域ネットワーク、手動納品条件をプラットフォームが確認します。" },
  ko: { metadataTitle: "GPU 컴퓨팅 디렉터리", metadataDescription: "공급자 GPU 견적을 확인하고 로그인 후 문의 및 수동 인도를 요청하세요.", fallback: "공급자 GPU 견적 불러오는 중…", heading: "공급자 GPU 패키지", lead: "공급자, GPU 사양 및 카드시간 참고 가격을 확인하세요. 패키지를 선택해 문의하면 플랫폼이 재고, 지역 네트워크 및 수동 인도 조건을 확인합니다." },
  fr: { metadataTitle: "Catalogue de calcul GPU", metadataDescription: "Consultez les prix GPU des fournisseurs, puis connectez-vous pour demander un devis et une livraison manuelle.", fallback: "Chargement des offres GPU fournisseurs…", heading: "Offres GPU fournisseurs", lead: "Consultez fournisseurs, caractéristiques GPU et prix indicatifs en heures-carte. Envoyez une demande pour que la plateforme confirme le stock, le réseau régional et les conditions de livraison manuelle." },
  th: { metadataTitle: "ไดเรกทอรีพลังประมวลผล GPU", metadataDescription: "ดูราคา GPU จากผู้ให้บริการ แล้วเข้าสู่ระบบเพื่อสอบถามราคาและขอส่งมอบโดยเจ้าหน้าที่", fallback: "กำลังโหลดราคา GPU จากผู้ให้บริการ…", heading: "แพ็กเกจ GPU จากผู้ให้บริการ", lead: "ดูผู้ให้บริการ สเปก GPU และราคาอ้างอิงชั่วโมงการ์ด เลือกแพ็กเกจแล้วส่งคำขอให้แพลตฟอร์มยืนยันสต็อก เครือข่ายภูมิภาค และเงื่อนไขส่งมอบโดยเจ้าหน้าที่" },
  vi: { metadataTitle: "Danh mục năng lực GPU", metadataDescription: "Xem báo giá GPU của nhà cung cấp, sau đó đăng nhập để hỏi giá và yêu cầu bàn giao thủ công.", fallback: "Đang tải báo giá GPU của nhà cung cấp…", heading: "Gói GPU của nhà cung cấp", lead: "Xem nhà cung cấp, thông số GPU và giá tham khảo theo giờ-thẻ. Chọn gói và gửi hỏi giá để nền tảng xác nhận tồn kho, mạng khu vực và điều kiện bàn giao thủ công." },
  id: { metadataTitle: "Direktori Komputasi GPU", metadataDescription: "Lihat penawaran GPU pemasok, lalu masuk untuk mengajukan pertanyaan dan pengiriman manual.", fallback: "Memuat penawaran GPU pemasok…", heading: "Paket GPU pemasok", lead: "Tinjau pemasok, spesifikasi GPU, dan harga referensi jam-kartu. Pilih paket dan ajukan pertanyaan agar platform mengonfirmasi stok, jaringan regional, dan ketentuan pengiriman manual." },
  ms: { metadataTitle: "Direktori Pengkomputeran GPU", metadataDescription: "Lihat sebut harga GPU pembekal, kemudian log masuk untuk menghantar pertanyaan dan memohon penghantaran manual.", fallback: "Memuatkan sebut harga GPU pembekal…", heading: "Pakej GPU pembekal", lead: "Semak pembekal, spesifikasi GPU dan harga rujukan jam-kad. Pilih pakej dan hantar pertanyaan supaya platform mengesahkan stok, rangkaian serantau dan syarat penghantaran manual." },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const copy = GPU_PAGE_COPY[locale];
  return { title: copy.metadataTitle, description: copy.metadataDescription };
}

const gpuListings = partitionBuyCatalog(resourceListings, suppliers).primary;
const gpuClassifications = Object.fromEntries(gpuListings.map((listing) => [listing.id, classifyBuyCatalogListing(listing, suppliers)]));

function GpuDirectoryFallback({ copy }: { copy: GpuPageCopy }) {
  return <div className="shell py-24 text-center" role="status">{copy.fallback}</div>;
}

async function hostingMarketReady() {
  if (!isHostingV2Enabled()) return false;
  try {
    await requireHostingV2TransactionCapability();
    return true;
  } catch {
    return false;
  }
}

export default async function GpuMarketplacePage() {
  const locale = await getRequestLocale();
  const copy = GPU_PAGE_COPY[locale];
  if (await hostingMarketReady()) return <HostingGpuMarketplace />;
  return (
    <Suspense fallback={<GpuDirectoryFallback copy={copy} />}>
      <ResourceExplorer
        classifications={gpuClassifications}
        heading={copy.heading}
        inquiryEnabled={isBuyCatalogV2Enabled() && manualDeliveryIntakeEnabled()}
        lead={copy.lead}
        listings={gpuListings}
      />
    </Suspense>
  );
}
