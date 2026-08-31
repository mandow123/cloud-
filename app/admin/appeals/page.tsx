import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminManualAppeals } from "@/components/admin-manual-appeals";
import type { Locale } from "@/lib/i18n";
import { manualAppealsEnabled } from "@/lib/server/manual-appeals";
import { getRequestLocale } from "@/lib/server/request-locale";

const METADATA_COPY = {
  "zh-CN": ["人工申诉", "处理人工交付申请的申诉、双方消息和线下凭证核验状态。"], "zh-TW": ["人工申訴", "處理人工交付申訴、雙方訊息與線下憑證核驗狀態。"], en: ["Manual Appeals", "Handle manual-delivery appeals, party messages, and offline evidence verification."], ja: ["手動納品の申立て", "手動納品の申立て、当事者メッセージ、オフライン証憑の検証状態を処理します。"], ko: ["수동 제공 이의제기", "수동 제공 이의제기, 당사자 메시지 및 오프라인 증빙 검증 상태를 처리합니다."], fr: ["Contestations manuelles", "Traiter les contestations de livraison, les messages et la vérification des justificatifs hors ligne."], th: ["คำร้องการส่งมอบโดยเจ้าหน้าที่", "จัดการคำร้อง ข้อความคู่กรณี และสถานะตรวจสอบหลักฐานออฟไลน์"], vi: ["Khiếu nại bàn giao thủ công", "Xử lý khiếu nại, tin nhắn các bên và trạng thái xác minh chứng từ ngoại tuyến."], id: ["Banding Penyerahan Manual", "Tangani banding, pesan para pihak, dan verifikasi bukti luring."], ms: ["Rayuan Penyerahan Manual", "Urus rayuan, mesej pihak dan pengesahan bukti luar talian."],
} satisfies Record<Locale, readonly [string, string]>;
export async function generateMetadata(): Promise<Metadata> { const [title, description] = METADATA_COPY[await getRequestLocale()]; return { title, description }; }
export default function AdminAppealsPage() { if (!manualAppealsEnabled()) notFound(); return <AdminManualAppeals />; }
