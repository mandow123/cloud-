import type { Metadata } from "next";
import { SupplyOfferForm } from "@/components/supply-offer-form";
import type { Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/server/request-locale";

const SUPPLY_APPLY_METADATA = {
  "zh-CN": ["提交上架申请", "提交资源规格、数量、地区和交付方式，保存到 KAI Cloud 供给数据库等待人工审核。"],
  "zh-TW": ["提交上架申請", "提交資源規格、數量、地區和交付方式，儲存至 KAI Cloud 供給資料庫等待人工審核。"],
  en: ["Submit a listing application", "Submit specifications, quantity, region, and delivery method for manual review in the KAI Cloud supply database."],
  ja: ["掲載申請を提出", "資源仕様、数量、地域、納品方法を KAI Cloud の供給データベースに保存し、手動審査を待ちます。"],
  ko: ["등록 신청 제출", "자원 사양, 수량, 지역 및 인도 방식을 KAI Cloud 공급 데이터베이스에 저장하고 수동 검토를 기다립니다."],
  fr: ["Soumettre une demande de publication", "Enregistrez caractéristiques, quantité, région et mode de livraison dans la base d’offre KAI Cloud pour examen manuel."],
  th: ["ส่งคำขอลงรายการ", "ส่งสเปก จำนวน ภูมิภาค และวิธีส่งมอบไปยังฐานข้อมูลผู้ให้บริการ KAI Cloud เพื่อรอการตรวจสอบโดยเจ้าหน้าที่"],
  vi: ["Gửi đơn đăng nguồn lực", "Lưu thông số, số lượng, khu vực và phương thức bàn giao vào cơ sở dữ liệu nguồn cung KAI Cloud để chờ xét duyệt thủ công."],
  id: ["Kirim pengajuan listing", "Simpan spesifikasi, jumlah, wilayah, dan metode pengiriman ke basis data pasokan KAI Cloud untuk tinjauan manual."],
  ms: ["Hantar permohonan penyenaraian", "Simpan spesifikasi, kuantiti, wilayah dan kaedah penghantaran dalam pangkalan data bekalan KAI Cloud untuk semakan manual."],
} as const satisfies Record<Locale, readonly [string, string]>;

export async function generateMetadata(): Promise<Metadata> {
  const [title, description] = SUPPLY_APPLY_METADATA[await getRequestLocale()];
  return { title, description };
}

export default function SupplyApplicationCreatePage() {
  return <SupplyOfferForm />;
}
