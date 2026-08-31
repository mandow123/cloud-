import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { MemberCardHourAssets } from "@/components/member-card-hour-assets";
import type { Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/server/request-locale";

const copy = {
  "zh-CN": ["我的资产与卡时账户", "查看 KAI 标准卡时资产并选择已开放的充值支付方式。", "管理卡时资产"],
  "zh-TW": ["我的資產與卡時帳戶", "查看 KAI 標準卡時資產並選擇已開放的儲值付款方式。", "管理卡時資產"],
  en: ["My assets and card-hours", "View KAI standard card-hour assets and select an available top-up payment method.", "Manage card-hour assets"],
  ja: ["資産とカード時口座", "KAI 標準カード時資産を確認し、利用可能なチャージ決済方法を選択します。", "カード時資産を管理"],
  ko: ["내 자산 및 카드시간 계정", "KAI 표준 카드시간 자산을 확인하고 사용 가능한 충전 결제 수단을 선택합니다.", "카드시간 자산 관리"],
  fr: ["Mes actifs et heures-carte", "Consultez vos heures-carte KAI et choisissez un moyen de paiement disponible pour la recharge.", "Gérer les heures-carte"],
  th: ["สินทรัพย์และบัญชีชั่วโมงการ์ด", "ดูสินทรัพย์ชั่วโมงการ์ด KAI และเลือกช่องทางชำระเงินสำหรับเติมเงินที่เปิดใช้", "จัดการสินทรัพย์ชั่วโมงการ์ด"],
  vi: ["Tài sản và tài khoản giờ-thẻ", "Xem tài sản giờ-thẻ KAI và chọn phương thức thanh toán nạp tiền đang mở.", "Quản lý tài sản giờ-thẻ"],
  id: ["Aset dan akun jam-kartu", "Lihat aset jam-kartu KAI dan pilih metode pembayaran isi ulang yang tersedia.", "Kelola aset jam-kartu"],
  ms: ["Aset dan akaun jam-kad", "Lihat aset jam-kad KAI dan pilih kaedah pembayaran tambah nilai yang tersedia.", "Urus aset jam-kad"],
} as const satisfies Record<Locale, readonly [string, string, string]>;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: copy[locale][0], description: copy[locale][1] };
}

export default async function MemberCardHoursPage() {
  const locale = await getRequestLocale();
  return <AccountRequired purpose={copy[locale][2]} redirectOnSignedOut><MemberCardHourAssets /></AccountRequired>;
}
