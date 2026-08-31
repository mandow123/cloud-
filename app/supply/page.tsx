import type { Metadata } from "next";
import { AccountConsoleOverview } from "@/components/account-console-overview";
import { SupplierManualCommercialOrders } from "@/components/manual-commercial-orders";
import { SupplyDashboard } from "@/components/supply-dashboard";
import { SupplierManualDeliveries } from "@/components/supplier-manual-deliveries";
import { isAccountConsoleV2Enabled } from "@/lib/server/account-console-feature";
import { manualAppealsEnabled } from "@/lib/server/manual-appeals";
import { manualOrderFlowEnabled } from "@/lib/server/manual-order-feature";
import type { Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/server/request-locale";

const SUPPLY_PAGE_METADATA = {
  "zh-CN": ["供应概览", "查看当前组织的供应资源申请、人工审核状态与最近提交记录。"],
  "zh-TW": ["供應概覽", "查看目前組織的供應資源申請、人工審核狀態與最近提交記錄。"],
  en: ["Supply overview", "Review this organization’s supply applications, manual review status, and recent submissions."],
  ja: ["供給概要", "現在の組織の供給申請、手動審査状況、最近の提出を確認します。"],
  ko: ["공급 개요", "현재 조직의 공급 자원 신청, 수동 검토 상태 및 최근 제출을 확인합니다."],
  fr: ["Vue d’ensemble de l’offre", "Consultez les demandes d’offre, leur examen manuel et les soumissions récentes de l’organisation."],
  th: ["ภาพรวมการจัดหา", "ดูคำขอทรัพยากร สถานะการตรวจสอบโดยเจ้าหน้าที่ และรายการที่ส่งล่าสุดขององค์กรปัจจุบัน"],
  vi: ["Tổng quan nguồn cung", "Xem đơn đăng nguồn lực, trạng thái xét duyệt thủ công và các lần gửi gần đây của tổ chức hiện tại."],
  id: ["Ringkasan pasokan", "Tinjau pengajuan sumber daya, status tinjauan manual, dan pengajuan terbaru organisasi ini."],
  ms: ["Ringkasan bekalan", "Lihat permohonan sumber, status semakan manual dan penyerahan terkini organisasi ini."],
} as const satisfies Record<Locale, readonly [string, string]>;

export async function generateMetadata(): Promise<Metadata> {
  const [title, description] = SUPPLY_PAGE_METADATA[await getRequestLocale()];
  return { title, description };
}

export default function SupplyPage() {
  return <>{isAccountConsoleV2Enabled() ? <AccountConsoleOverview mode="supplier" /> : <SupplyDashboard />}{manualOrderFlowEnabled() ? <div className="shell"><SupplierManualCommercialOrders /></div> : null}<SupplierManualDeliveries appealsEnabled={manualAppealsEnabled()} /></>;
}
