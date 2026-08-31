"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { MarketplaceApiError, marketplaceGet } from "@/lib/client/marketplace-client";
import type { Locale } from "@/lib/i18n";
import type { ManualDeliveryStatus, SupplierManualDeliveryTask } from "@/lib/server/admin-store";
import styles from "./supplier-manual-deliveries.module.css";
import { SupplierManualAppeals } from "./supplier-manual-appeals";

type Payload = Readonly<{ records: SupplierManualDeliveryTask[]; count?: number }>;

type DeliveryCopy = {
  statuses: Record<ManualDeliveryStatus, string>; title: string; description: string; refresh: string; safeError: string; requestId: string; loading: string;
  emptyTitle: string; emptyDescription: string; packages: string; gpu: string; statusVersion: string; scope: string; deliveryDate: string; coordinating: string;
  duration: string; hours: string; pending: string; fingerprint: string; notCollected: string; started: string; boundary: string; footer: string; apply: string;
};
const DELIVERY_EN: DeliveryCopy = {
  statuses: { PENDING_MANUAL_DELIVERY: "Awaiting platform assignment", SUPPLIER_ASSIGNED: "Awaiting setup", DELIVERY_IN_PROGRESS: "Setup in progress", AWAITING_BUYER_ACCEPTANCE: "Awaiting buyer confirmation", COMPLETED: "Buyer confirmed", CANCELLED: "Cancelled", ACCESS_REVOKED: "Access revoked" },
  title: "Manual deliveries assigned to this organization", description: "Only tasks explicitly assigned to this organization are shown. Buyer names, email addresses, original public keys, and internal notes are excluded.", refresh: "Refresh tasks", safeError: "Manual delivery tasks cannot be loaded right now.", requestId: "Request ID", loading: "Loading manual delivery tasks…", emptyTitle: "No manual delivery tasks are assigned to this organization", emptyDescription: "Tasks appear only after the platform verifies the supplier relationship and assigns them; changing a browser role never exposes them.", packages: "packages", gpu: "GPUs", statusVersion: "Status version", scope: "Service area", deliveryDate: "Expected delivery date", coordinating: "Platform coordination pending", duration: "Rental duration", hours: "hours", pending: "Pending confirmation", fingerprint: "Buyer public-key fingerprint", notCollected: "Not collected", started: "Setup started", boundary: "This page does not expose buyer identity, the original SSH public key, connection details, or internal platform notes. Platform administrators coordinate and record setup operations.", footer: "Need to add supply resources or delivery capacity?", apply: "Submit listing application →",
};
const DELIVERY_ZH: DeliveryCopy = {
  statuses: { PENDING_MANUAL_DELIVERY: "待平台分配", SUPPLIER_ASSIGNED: "待开始配置", DELIVERY_IN_PROGRESS: "配置中", AWAITING_BUYER_ACCEPTANCE: "等待买家确认", COMPLETED: "买家已确认", CANCELLED: "已取消", ACCESS_REVOKED: "访问已撤销" },
  title: "分配给本组织的人工交付", description: "只显示平台明确分配给当前组织的任务；不包含买家姓名、邮箱、原始公钥或管理员内部备注。", refresh: "刷新任务", safeError: "人工交付任务暂时无法读取。", requestId: "请求编号", loading: "正在读取人工交付任务…", emptyTitle: "当前没有分配给本组织的人工交付任务", emptyDescription: "任务由平台管理员核对供应关系后分配，不会因为浏览器角色切换而出现。", packages: "套", gpu: "张 GPU", statusVersion: "状态版本", scope: "服务范围", deliveryDate: "期望交付日", coordinating: "待平台协调", duration: "租用时长", hours: "小时", pending: "待确认", fingerprint: "买家公钥指纹", notCollected: "尚未收集", started: "开始配置", boundary: "本页不展示买家身份、SSH 原始公钥、连接地址或平台内部备注。配置操作由平台管理员协调并记录。", footer: "需要补充供应资源或交付能力？", apply: "提交上架申请 →",
};
const DELIVERY_COPY = {
  "zh-CN": DELIVERY_ZH,
  "zh-TW": { ...DELIVERY_ZH, statuses: { PENDING_MANUAL_DELIVERY: "待平台分配", SUPPLIER_ASSIGNED: "待開始設定", DELIVERY_IN_PROGRESS: "設定中", AWAITING_BUYER_ACCEPTANCE: "等待買家確認", COMPLETED: "買家已確認", CANCELLED: "已取消", ACCESS_REVOKED: "存取已撤銷" }, title: "分配給本組織的人工交付", description: "只顯示平台明確分配給目前組織的任務；不包含買家姓名、電子郵件、原始公鑰或管理員內部備註。", refresh: "重新整理任務", safeError: "目前無法讀取人工交付任務。", requestId: "請求編號", loading: "正在讀取人工交付任務…", emptyTitle: "目前沒有分配給本組織的人工交付任務", emptyDescription: "任務由平台管理員核對供應關係後分配，不會因瀏覽器角色切換而出現。", packages: "套", gpu: "張 GPU", statusVersion: "狀態版本", scope: "服務範圍", deliveryDate: "期望交付日", coordinating: "待平台協調", duration: "租用時長", hours: "小時", pending: "待確認", fingerprint: "買家公鑰指紋", notCollected: "尚未收集", started: "開始設定", boundary: "本頁不顯示買家身分、SSH 原始公鑰、連線位址或平台內部備註。設定操作由平台管理員協調並記錄。", footer: "需要補充供應資源或交付能力？", apply: "提交上架申請 →" },
  en: DELIVERY_EN,
  ja: { ...DELIVERY_EN, title: "この組織に割り当てられた手動納品", description: "この組織に明示的に割り当てられたタスクのみ表示します。購入者名、メール、元の公開鍵、内部メモは表示しません。", refresh: "タスクを更新", safeError: "現在、手動納品タスクを読み込めません。", requestId: "リクエスト ID", loading: "手動納品タスクを読込中…", emptyTitle: "割り当てられた手動納品タスクはありません" },
  ko: { ...DELIVERY_EN, title: "이 조직에 할당된 수동 제공", description: "플랫폼이 이 조직에 명시적으로 할당한 작업만 표시합니다. 구매자 이름, 이메일, 원본 공개키 및 내부 메모는 제외됩니다.", refresh: "작업 새로고침", safeError: "현재 수동 제공 작업을 불러올 수 없습니다.", requestId: "요청 ID", loading: "수동 제공 작업을 불러오는 중…", emptyTitle: "이 조직에 할당된 수동 제공 작업이 없습니다" },
  fr: { ...DELIVERY_EN, title: "Livraisons manuelles attribuées à cette organisation", description: "Seules les tâches explicitement attribuées sont affichées. L’identité de l’acheteur, son e-mail, la clé publique originale et les notes internes sont exclus.", refresh: "Actualiser", safeError: "Les tâches de livraison sont momentanément indisponibles.", requestId: "ID de requête", loading: "Chargement des livraisons…", emptyTitle: "Aucune livraison manuelle attribuée" },
  th: { ...DELIVERY_EN, title: "งานส่งมอบโดยเจ้าหน้าที่ที่มอบหมายให้องค์กรนี้", description: "แสดงเฉพาะงานที่แพลตฟอร์มมอบหมายให้องค์กรนี้ และไม่แสดงชื่อ อีเมล กุญแจสาธารณะต้นฉบับ หรือบันทึกภายในของผู้ซื้อ", refresh: "รีเฟรชงาน", safeError: "ยังไม่สามารถโหลดงานส่งมอบได้", requestId: "รหัสคำขอ", loading: "กำลังโหลดงานส่งมอบ…", emptyTitle: "ไม่มีงานส่งมอบที่มอบหมายให้องค์กรนี้" },
  vi: { ...DELIVERY_EN, title: "Bàn giao thủ công được giao cho tổ chức này", description: "Chỉ hiển thị nhiệm vụ được nền tảng giao rõ ràng. Không hiển thị tên, email, khóa công khai gốc hoặc ghi chú nội bộ của người mua.", refresh: "Làm mới", safeError: "Hiện không thể tải nhiệm vụ bàn giao.", requestId: "ID yêu cầu", loading: "Đang tải nhiệm vụ bàn giao…", emptyTitle: "Không có nhiệm vụ bàn giao được giao" },
  id: { ...DELIVERY_EN, title: "Penyerahan manual untuk organisasi ini", description: "Hanya tugas yang ditetapkan secara tegas oleh platform yang ditampilkan. Nama, email, kunci publik asli, dan catatan internal pembeli tidak ditampilkan.", refresh: "Muat ulang", safeError: "Tugas penyerahan belum dapat dimuat.", requestId: "ID permintaan", loading: "Memuat tugas penyerahan…", emptyTitle: "Tidak ada tugas penyerahan yang ditetapkan" },
  ms: { ...DELIVERY_EN, title: "Penyerahan manual untuk organisasi ini", description: "Hanya tugas yang ditetapkan secara jelas oleh platform dipaparkan. Nama, e-mel, kunci awam asal dan nota dalaman pembeli tidak dipaparkan.", refresh: "Muat semula", safeError: "Tugas penyerahan belum dapat dimuatkan.", requestId: "ID permintaan", loading: "Memuatkan tugas penyerahan…", emptyTitle: "Tiada tugas penyerahan yang ditetapkan" },
} satisfies Record<Locale, DeliveryCopy>;

function dateTime(value: string | null, locale: Locale) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date); }

function safeDeliveryError(reason: unknown, copy: DeliveryCopy) {
  const requestId = reason instanceof MarketplaceApiError ? reason.requestId : undefined;
  return `${copy.safeError}${requestId ? ` (${copy.requestId}: ${requestId})` : ""}`;
}

export function SupplierManualDeliveries({ appealsEnabled = false }: { appealsEnabled?: boolean }) {
  const { locale } = useLocale();
  const copy = DELIVERY_COPY[locale];
  const [records, setRecords] = useState<SupplierManualDeliveryTask[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { const payload = await marketplaceGet<Payload>("/api/v1/supply/manual-deliveries"); setRecords(Array.isArray(payload.records) ? payload.records : []); }
    catch (reason) { setError(safeDeliveryError(reason, copy)); }
  }, [copy]);
  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load(); }); return () => window.cancelAnimationFrame(frame); }, [load]);

  return <><section className={styles.section} aria-labelledby="supplier-manual-delivery-title">
    <header className={styles.head}><div><p>MANUAL DELIVERY</p><h2 id="supplier-manual-delivery-title">{copy.title}</h2><span>{copy.description}</span></div><button className="button button-secondary" onClick={() => void load()} type="button">{copy.refresh}</button></header>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {!error && records === null ? <p className={styles.empty} role="status">{copy.loading}</p> : null}
    {!error && records?.length === 0 ? <div className={styles.empty}><strong>{copy.emptyTitle}</strong><p>{copy.emptyDescription}</p></div> : null}
    {records?.length ? <div className={styles.list}>{records.map((record) => <article className={styles.task} key={record.demandId}>
      <div className={styles.identity}><span>{record.demandId}</span><h3>{record.resource.title}</h3><p>{record.resource.gpuDescription} · {record.request.quantity} {copy.packages} / {record.request.totalGpuCount} {copy.gpu}</p></div>
      <div className={styles.status}><strong>{copy.statuses[record.status]}</strong><span>{copy.statusVersion} {record.statusVersion}</span><time dateTime={record.updatedAt}>{dateTime(record.updatedAt, locale)}</time></div>
      <dl className={styles.facts}><div><dt>{copy.scope}</dt><dd>{record.resource.region}</dd></div><div><dt>{copy.deliveryDate}</dt><dd>{record.request.deliveryDate ?? copy.coordinating}</dd></div><div><dt>{copy.duration}</dt><dd>{record.request.durationHours ? `${record.request.durationHours} ${copy.hours}` : copy.pending}</dd></div><div><dt>{copy.fingerprint}</dt><dd className={styles.fingerprint}>{record.sshPublicKeyFingerprint ?? copy.notCollected}</dd></div><div><dt>{copy.started}</dt><dd>{dateTime(record.deliveryTimeline.startedAt, locale)}</dd></div></dl>
      <p className={styles.boundary}>{copy.boundary}</p>
    </article>)}</div> : null}
    <footer className={styles.footer}><span>{copy.footer}</span><Link href="/supply/apply">{copy.apply}</Link></footer>
  </section>{appealsEnabled ? <SupplierManualAppeals /> : null}</>;
}
