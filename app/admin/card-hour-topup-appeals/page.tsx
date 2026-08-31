import type { Metadata } from "next";
import { AdminCardHourTopupAppeals } from "@/components/admin-card-hour-topup-appeals";
import type { Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/server/request-locale";

const METADATA_COPY = {
  "zh-CN": ["充值异常申诉", "按付款单查看和处理用户充值异常申诉，不直接修改支付或卡时状态。"], "zh-TW": ["充值異常申訴", "依付款單查看與處理充值異常申訴，不直接修改付款或卡時狀態。"], en: ["Top-up Appeals", "Review card-hour top-up appeals by payment order without changing payment or balance state."], ja: ["チャージ異常申立て", "支払い注文ごとに申立てを確認し、支払い・カード時状態は直接変更しません。"], ko: ["충전 이상 이의제기", "결제 주문별 충전 이의제기를 검토하며 결제 또는 카드시간 상태를 직접 변경하지 않습니다."], fr: ["Contestations de recharge", "Traiter les contestations par ordre de paiement sans modifier le paiement ni le solde."], th: ["คำร้องปัญหาการเติมเงิน", "ตรวจสอบคำร้องตามรายการชำระเงินโดยไม่แก้ไขสถานะการชำระหรือยอดชั่วโมงการ์ด"], vi: ["Khiếu nại nạp tiền", "Xử lý khiếu nại theo đơn thanh toán mà không sửa trạng thái thanh toán hay số dư."], id: ["Banding Isi Ulang", "Tinjau banding per pesanan pembayaran tanpa mengubah status pembayaran atau saldo."], ms: ["Rayuan Tambah Nilai", "Semak rayuan mengikut pesanan bayaran tanpa mengubah status bayaran atau baki."],
} satisfies Record<Locale, readonly [string, string]>;
export async function generateMetadata(): Promise<Metadata> { const [title, description] = METADATA_COPY[await getRequestLocale()]; return { title, description }; }
export default function AdminCardHourTopupAppealsPage() { return <AdminCardHourTopupAppeals />; }
