"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { adminGetRows } from "@/components/admin-api-client";
import { useLocale } from "@/components/locale-provider";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import { createIdempotencyKey, MarketplaceApiError, marketplaceGet, marketplacePost, safeMarketplaceErrorMessage } from "@/lib/client/marketplace-client";
import type { Locale } from "@/lib/i18n";
import type { ManualCommercialOrderStatus, ManualCommercialOrderView, SupplierManualDeliveryTask } from "@/lib/server/admin-store";

type OrderPayload = Readonly<{ records?: ManualCommercialOrderView[] }>;
type DeliveryPayload = Readonly<{ records?: SupplierManualDeliveryTask[] }>;

type MemberOrderErrorCopy = { load: string; hold: string; action: string; conflict: string; requestId: string; retry: (seconds: number) => string };
const MEMBER_ORDER_ERROR_COPY = {
  "zh-CN": { load: "人工算力订单暂时无法读取。", hold: "卡时锁定失败。余额不足时请先充值卡时。", action: "订单操作失败，请稍后重试。", conflict: "订单状态已经变化，已刷新最新版本，请重新确认。", requestId: "请求编号", retry: (seconds) => `可在 ${seconds} 秒后重试。` },
  "zh-TW": { load: "目前無法讀取人工算力訂單。", hold: "卡時鎖定失敗；餘額不足時請先充值。", action: "訂單操作失敗，請稍後重試。", conflict: "訂單狀態已變更，已載入最新版本，請重新確認。", requestId: "請求編號", retry: (seconds) => `可於 ${seconds} 秒後重試。` },
  en: { load: "Manual compute orders cannot be loaded right now.", hold: "Card-hours could not be held. Top up first if the balance is insufficient.", action: "The order action failed. Try again later.", conflict: "The order changed. The latest version was loaded; confirm again.", requestId: "Request ID", retry: (seconds) => `Try again in ${seconds} seconds.` },
  ja: { load: "現在、手動コンピュート注文を読み込めません。", hold: "カード時を保留できませんでした。残高不足の場合は先にチャージしてください。", action: "注文操作に失敗しました。後でもう一度お試しください。", conflict: "注文状態が変更されました。最新版を確認してください。", requestId: "リクエスト ID", retry: (seconds) => `${seconds} 秒後に再試行できます。` },
  ko: { load: "현재 수동 컴퓨팅 주문을 불러올 수 없습니다.", hold: "카드시간을 보류하지 못했습니다. 잔액이 부족하면 먼저 충전하세요.", action: "주문 작업에 실패했습니다. 나중에 다시 시도하세요.", conflict: "주문 상태가 변경되어 최신 버전을 불러왔습니다. 다시 확인하세요.", requestId: "요청 ID", retry: (seconds) => `${seconds}초 후 다시 시도할 수 있습니다.` },
  fr: { load: "Les commandes de calcul manuelles sont momentanément indisponibles.", hold: "Impossible de bloquer les heures-carte. Rechargez le solde si nécessaire.", action: "L’action sur la commande a échoué. Réessayez plus tard.", conflict: "La commande a changé. La dernière version a été chargée.", requestId: "ID de requête", retry: (seconds) => `Réessayez dans ${seconds} secondes.` },
  th: { load: "ยังไม่สามารถโหลดคำสั่งซื้อประมวลผลแบบเจ้าหน้าที่ได้", hold: "พักชั่วโมงการ์ดไม่สำเร็จ หากยอดไม่พอให้เติมก่อน", action: "ดำเนินการคำสั่งซื้อไม่สำเร็จ โปรดลองอีกครั้งภายหลัง", conflict: "สถานะคำสั่งซื้อเปลี่ยนแล้ว ระบบโหลดข้อมูลล่าสุด โปรดยืนยันอีกครั้ง", requestId: "รหัสคำขอ", retry: (seconds) => `ลองอีกครั้งใน ${seconds} วินาที` },
  vi: { load: "Hiện không thể tải đơn điện toán thủ công.", hold: "Không thể giữ giờ-thẻ. Hãy nạp thêm nếu số dư không đủ.", action: "Thao tác đơn hàng thất bại. Hãy thử lại sau.", conflict: "Đơn hàng đã thay đổi. Phiên bản mới nhất đã được tải.", requestId: "ID yêu cầu", retry: (seconds) => `Thử lại sau ${seconds} giây.` },
  id: { load: "Pesanan komputasi manual belum dapat dimuat.", hold: "Jam-kartu gagal ditahan. Isi ulang dahulu jika saldo tidak cukup.", action: "Tindakan pesanan gagal. Coba lagi nanti.", conflict: "Status pesanan berubah. Versi terbaru telah dimuat.", requestId: "ID permintaan", retry: (seconds) => `Coba lagi dalam ${seconds} detik.` },
  ms: { load: "Pesanan pengkomputeran manual belum dapat dimuatkan.", hold: "Jam-kad gagal ditahan. Tambah nilai dahulu jika baki tidak mencukupi.", action: "Tindakan pesanan gagal. Cuba lagi kemudian.", conflict: "Status pesanan berubah. Versi terkini telah dimuatkan.", requestId: "ID permintaan", retry: (seconds) => `Cuba lagi dalam ${seconds} saat.` },
} satisfies Record<Locale, MemberOrderErrorCopy>;

const statusLabels: Record<ManualCommercialOrderStatus, string> = {
  OFFERED: "供应商已报价",
  CARD_HOURS_HELD: "卡时已锁定，等待准备",
  PREPARING: "供应商准备中",
  READY: "连接入口待确认",
  CONNECTION_CONFIRMED: "连接已确认，服务中",
  AWAITING_ACCEPTANCE: "服务结束，待最终验收",
  COMPLETED: "已验收，结算资格已生成",
  CANCELLED: "已取消",
};

type SupplierOrderCopy = {
  statuses: Record<ManualCommercialOrderStatus, string>; title: string; description: string; refresh: string; safeError: string; requestId: string;
  demand: string; choose: string; quote: string; quotePlaceholder: string; summary: string; expected: string; submitting: string; submit: string;
  offerSaved: string; deliveryConflict: string; orderConflict: string; invalidActual: string; updated: string; offerVersion: string; cardHours: string;
  quoteLabel: string; funds: string; deliveryNotes: string; receivable: string; platformFee: string; payoutClosed: string;
  waitingBuyer: string; prepare: string; saveConnection: string; connectionReady: string; waitingConnection: string; actual: string; finish: string;
  waitingAcceptance: string; completed: string; pending: string; held: string; captured: string; released: string; releasedOnly: string;
};

const ORDER_EN: SupplierOrderCopy = {
  statuses: { OFFERED: "Supplier quoted", CARD_HOURS_HELD: "Card-hours held", PREPARING: "Preparing", READY: "Connection awaiting confirmation", CONNECTION_CONFIRMED: "In service", AWAITING_ACCEPTANCE: "Awaiting final acceptance", COMPLETED: "Accepted; settlement eligible", CANCELLED: "Cancelled" },
  title: "Manual compute orders", description: "Quote first, then prepare delivery only after the buyer holds card-hours. HELD is not a charge.", refresh: "Refresh orders", safeError: "Manual orders cannot be processed right now.", requestId: "Request ID",
  demand: "Request to quote", choose: "Select", quote: "Formal quote (card-hours)", quotePlaceholder: "Example: 4896.00", summary: "Service and delivery notes", expected: "Expected delivery (optional)", submitting: "Submitting…", submit: "Submit formal quote",
  offerSaved: "The formal quote version was saved. Waiting for the buyer to confirm and hold card-hours.", deliveryConflict: "The delivery task changed. The latest version was loaded; please quote again.", orderConflict: "The order changed. The latest version was loaded; please confirm again.", invalidActual: "Actual card-hours must use at most two decimals and cannot exceed the held amount.", updated: "Order fulfillment status updated.", offerVersion: "Quote version", cardHours: "card-hours",
  quoteLabel: "Quote", funds: "Funds status", deliveryNotes: "Delivery notes", receivable: "Supplier CNY receivable", platformFee: "Platform fee", payoutClosed: "Real payout is CLOSED; withdrawal and payout are unavailable.",
  waitingBuyer: "Waiting for the buyer to accept the quote and hold card-hours. Delivery must not start yet.", prepare: "Start preparing resources", saveConnection: "Save the authorized connection through the existing manual-delivery flow before marking it ready.", connectionReady: "Connection is ready", waitingConnection: "Waiting for the buyer to confirm the connection.", actual: "Actual service card-hours", finish: "Mark service complete", waitingAcceptance: "Waiting for final buyer acceptance. Card-hours remain uncharged and settlement is not yet eligible.", completed: "The buyer accepted delivery. Actual card-hours were charged and settlement eligibility was created; real payout remains closed.",
  pending: "Card-hours not held", held: "Held {held} card-hours (HELD, not charged)", captured: "Charged {captured} card-hours; released {released} card-hours", released: "Released {released} card-hours", releasedOnly: "Released",
};
const ORDER_ZH: SupplierOrderCopy = {
  statuses: statusLabels, title: "人工算力订单", description: "先报价，买家锁定卡时后再准备交付。HELD 不等于已扣减。", refresh: "刷新订单", safeError: "人工订单暂时无法处理。", requestId: "请求编号",
  demand: "待报价需求", choose: "请选择", quote: "正式报价（卡时）", quotePlaceholder: "例如 4896.00", summary: "服务与交付说明", expected: "预计交付时间（可选）", submitting: "提交中…", submit: "提交正式卡时报价",
  offerSaved: "正式报价版本已保存，等待买家确认并锁定卡时。", deliveryConflict: "交付任务已经变化，已刷新最新版本，请重新报价。", orderConflict: "订单状态已经变化，已刷新最新版本，请重新确认。", invalidActual: "实际卡时必须为两位以内小数，且不能超过已锁定卡时。", updated: "订单履约状态已更新。", offerVersion: "报价版本", cardHours: "卡时",
  quoteLabel: "报价", funds: "资金状态", deliveryNotes: "交付说明", receivable: "供应商人民币结算应收", platformFee: "平台费", payoutClosed: "真实出款 CLOSED，当前不可发起提现或打款。", waitingBuyer: "等待买家确认报价并锁定卡时；此时不得开始交付。", prepare: "开始准备资源", saveConnection: "先由现有人工交付流程保存授权连接入口，再标记可连接。", connectionReady: "连接入口已就绪", waitingConnection: "等待买家确认连接可用。", actual: "实际服务卡时", finish: "标记服务结束", waitingAcceptance: "等待买家最终验收。验收前卡时仍未扣减，供应商尚无结算资格。", completed: "买家已验收，实际卡时已扣减并生成结算资格；真实出款仍关闭。", pending: "尚未锁定卡时", held: "已锁定 {held} 卡时（HELD，暂未扣减）", captured: "实际扣减 {captured} 卡时；释放 {released} 卡时", released: "已释放 {released} 卡时", releasedOnly: "已释放",
};
const ORDER_ZH_TW: SupplierOrderCopy = { ...ORDER_ZH, statuses: { OFFERED: "供應商已報價", CARD_HOURS_HELD: "卡時已鎖定", PREPARING: "供應商準備中", READY: "連線入口待確認", CONNECTION_CONFIRMED: "連線已確認，服務中", AWAITING_ACCEPTANCE: "待最終驗收", COMPLETED: "已驗收並具結算資格", CANCELLED: "已取消" }, title: "人工算力訂單", description: "先報價，買家鎖定卡時後再準備交付。HELD 不等於扣減。", refresh: "重新整理訂單", safeError: "目前無法處理人工訂單。", requestId: "請求編號", demand: "待報價需求", choose: "請選擇", quote: "正式報價（卡時）", summary: "服務與交付說明", expected: "預計交付時間（選填）", submitting: "提交中…", submit: "提交正式卡時報價", offerSaved: "正式報價版本已儲存，等待買家確認並鎖定卡時。", deliveryConflict: "交付任務已變更，已載入最新版本，請重新報價。", orderConflict: "訂單狀態已變更，已載入最新版本，請重新確認。", invalidActual: "實際卡時最多兩位小數，且不得超過已鎖定卡時。", updated: "訂單履約狀態已更新。", offerVersion: "報價版本", quoteLabel: "報價", funds: "資金狀態", deliveryNotes: "交付說明", receivable: "供應商人民幣結算應收", platformFee: "平台費", payoutClosed: "真實出款為 CLOSED，目前不可提現或打款。", waitingBuyer: "等待買家確認報價並鎖定卡時；此時不得開始交付。", prepare: "開始準備資源", saveConnection: "先透過現有人工交付流程儲存授權連線入口，再標記可連線。", connectionReady: "連線入口已就緒", waitingConnection: "等待買家確認連線可用。", actual: "實際服務卡時", finish: "標記服務結束", waitingAcceptance: "等待買家最終驗收。驗收前卡時尚未扣減，供應商尚無結算資格。", completed: "買家已驗收，實際卡時已扣減並建立結算資格；真實出款仍關閉。", pending: "尚未鎖定卡時", held: "已鎖定 {held} 卡時（HELD，尚未扣減）", captured: "實際扣減 {captured} 卡時；釋放 {released} 卡時", released: "已釋放 {released} 卡時", releasedOnly: "已釋放" };
const SUPPLIER_ORDER_COPY = {
  "zh-CN": ORDER_ZH, "zh-TW": ORDER_ZH_TW, en: ORDER_EN,
  ja: { ...ORDER_EN, title: "手動コンピュート注文", description: "見積後、購入者がカード時を保留してから納品準備を開始します。HELD は課金ではありません。", refresh: "注文を更新", safeError: "現在、手動注文を処理できません。", requestId: "リクエスト ID", statuses: { OFFERED: "見積済み", CARD_HOURS_HELD: "カード時保留済み", PREPARING: "準備中", READY: "接続確認待ち", CONNECTION_CONFIRMED: "サービス中", AWAITING_ACCEPTANCE: "最終検収待ち", COMPLETED: "検収済み", CANCELLED: "キャンセル" } },
  ko: { ...ORDER_EN, title: "수동 컴퓨팅 주문", description: "견적 후 구매자가 카드시간을 보류한 뒤 제공을 준비합니다. HELD는 차감이 아닙니다.", refresh: "주문 새로고침", safeError: "현재 수동 주문을 처리할 수 없습니다.", requestId: "요청 ID", statuses: { OFFERED: "견적 완료", CARD_HOURS_HELD: "카드시간 보류", PREPARING: "준비 중", READY: "연결 확인 대기", CONNECTION_CONFIRMED: "서비스 중", AWAITING_ACCEPTANCE: "최종 검수 대기", COMPLETED: "검수 완료", CANCELLED: "취소됨" } },
  fr: { ...ORDER_EN, title: "Commandes de calcul manuelles", description: "Établissez d’abord le devis, puis préparez la livraison après le blocage des heures-carte. HELD n’est pas un débit.", refresh: "Actualiser", safeError: "Les commandes manuelles sont momentanément indisponibles.", requestId: "ID de requête" },
  th: { ...ORDER_EN, title: "คำสั่งซื้อประมวลผลแบบเจ้าหน้าที่", description: "เสนอราคาก่อน และเตรียมส่งมอบหลังผู้ซื้อพักชั่วโมงการ์ดแล้ว HELD ไม่ใช่การหักยอด", refresh: "รีเฟรชคำสั่งซื้อ", safeError: "ยังไม่สามารถดำเนินการคำสั่งซื้อได้", requestId: "รหัสคำขอ" },
  vi: { ...ORDER_EN, title: "Đơn điện toán thủ công", description: "Báo giá trước, chỉ chuẩn bị bàn giao sau khi người mua giữ giờ-thẻ. HELD không phải là khấu trừ.", refresh: "Làm mới đơn", safeError: "Hiện không thể xử lý đơn thủ công.", requestId: "ID yêu cầu" },
  id: { ...ORDER_EN, title: "Pesanan komputasi manual", description: "Ajukan penawaran dahulu, lalu siapkan penyerahan setelah pembeli menahan jam-kartu. HELD bukan pemotongan.", refresh: "Muat ulang pesanan", safeError: "Pesanan manual belum dapat diproses.", requestId: "ID permintaan" },
  ms: { ...ORDER_EN, title: "Pesanan pengkomputeran manual", description: "Beri sebut harga dahulu, kemudian sediakan penyerahan selepas pembeli menahan jam-kad. HELD bukan potongan.", refresh: "Muat semula pesanan", safeError: "Pesanan manual belum dapat diproses.", requestId: "ID permintaan" },
} satisfies Record<Locale, SupplierOrderCopy>;

function safeSupplierOrderError(reason: unknown, copy: SupplierOrderCopy) {
  const requestId = reason instanceof MarketplaceApiError ? reason.requestId : undefined;
  return `${copy.safeError}${requestId ? ` (${copy.requestId}: ${requestId})` : ""}`;
}

function supplierHoldLabel(record: ManualCommercialOrderView, copy: SupplierOrderCopy) {
  if (record.hold.status === "NOT_HELD") return copy.pending;
  if (record.hold.status === "HELD") return copy.held.replace("{held}", formatCardHourDisplayMicros(record.hold.heldMicros));
  if (record.hold.status === "CAPTURED") return copy.captured.replace("{captured}", formatCardHourDisplayMicros(record.hold.capturedMicros ?? 0)).replace("{released}", formatCardHourDisplayMicros(record.hold.releasedMicros ?? 0));
  return copy.released.replace("{released}", formatCardHourDisplayMicros(record.hold.releasedMicros ?? record.hold.heldMicros));
}

function dateTime(value: string | null, locale: Locale = "zh-CN") {
  if (!value) return "待确认";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "待确认" : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function money(cents: number | null, locale: Locale = "zh-CN") {
  return cents === null ? "—" : new Intl.NumberFormat(locale, { style: "currency", currency: "CNY" }).format(cents / 100);
}

function parseCardHours(value: string) {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/u.exec(value.trim());
  if (!match) return null;
  const micros = Number(match[1]) * 1_000_000 + Number((match[2] ?? "").padEnd(2, "0")) * 10_000;
  return Number.isSafeInteger(micros) && micros > 0 ? micros : null;
}

function holdLabel(record: ManualCommercialOrderView) {
  if (record.hold.status === "NOT_HELD") return "尚未锁定卡时";
  if (record.hold.status === "HELD") return `已锁定 ${formatCardHourDisplayMicros(record.hold.heldMicros)} 卡时（HELD，暂未扣减）`;
  if (record.hold.status === "CAPTURED") return `实际扣减 ${formatCardHourDisplayMicros(record.hold.capturedMicros ?? 0)} 卡时；释放 ${formatCardHourDisplayMicros(record.hold.releasedMicros ?? 0)} 卡时`;
  return `已释放 ${formatCardHourDisplayMicros(record.hold.releasedMicros ?? record.hold.heldMicros)} 卡时`;
}

const sectionClass = "mt-8 border-t-4 border-[var(--accent)] bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-7";
const orderClass = "grid gap-4 border border-[var(--border)] bg-[var(--surface)] p-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,.7fr)]";

export function MemberManualCommercialOrders({ demandId }: { demandId?: string }) {
  const { locale } = useLocale();
  const errorCopy = MEMBER_ORDER_ERROR_COPY[locale];
  const [records, setRecords] = useState<ManualCommercialOrderView[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const load = useCallback(async () => {
    const payload = await marketplaceGet<OrderPayload>("/api/v1/member/manual-orders");
    const next = Array.isArray(payload.records) ? payload.records : [];
    setRecords(demandId ? next.filter((record) => record.demandId === demandId) : next);
  }, [demandId]);
  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load().catch((reason: unknown) => setError(safeMarketplaceErrorMessage(reason, errorCopy.load, { requestIdLabel: errorCopy.requestId, retryAfter: errorCopy.retry }))); }); return () => window.cancelAnimationFrame(frame); }, [errorCopy, load]);

  async function mutate(record: ManualCommercialOrderView, action: "accept-offer" | "confirm-connection" | "accept-completion") {
    setBusyId(record.id); setError(""); setNotice("");
    try {
      const result = await marketplacePost<ManualCommercialOrderView>(`/api/v1/member/manual-orders/${encodeURIComponent(record.id)}/${action}`, { expectedVersion: record.version }, createIdempotencyKey(`manual-order-${action}`));
      setRecords((current) => current?.map((item) => item.id === result.record.id ? result.record : item) ?? [result.record]);
      setConfirmingId(null);
      setNotice(action === "accept-offer" ? "卡时已由服务端锁定为 HELD；锁定不等于扣减。" : action === "confirm-connection" ? "连接可用确认已记录。" : "最终验收已记录；实际卡时已扣减，未使用部分已释放。 ");
    } catch (reason) {
      if (reason instanceof MarketplaceApiError && reason.status === 409) {
        await load().catch(() => undefined); setError(errorCopy.conflict);
      } else setError(safeMarketplaceErrorMessage(reason, action === "accept-offer" ? errorCopy.hold : errorCopy.action, { requestIdLabel: errorCopy.requestId, retryAfter: errorCopy.retry }));
    } finally { setBusyId(null); }
  }

  return <section className={sectionClass} aria-labelledby={demandId ? "member-manual-order-detail-title" : "member-manual-orders-title"}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="kicker">MANUAL COMPUTE ORDERS</p><h2 className="m-0 text-2xl" id={demandId ? "member-manual-order-detail-title" : "member-manual-orders-title"}>人工算力订单</h2><p className="mb-0 mt-2 text-sm text-[var(--muted)]">报价、卡时锁定、人工交付和最终验收均以服务端记录为准。</p></div><button className="button button-secondary" onClick={() => void load()} type="button">刷新订单</button></div>
    {error ? <p className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">{error}</p> : null}
    {notice ? <p className="mt-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4" role="status">{notice}</p> : null}
    {records === null ? <p className="mt-5 text-sm text-[var(--muted)]" role="status">正在读取人工订单…</p> : null}
    {records?.length === 0 ? <p className="mt-5 border border-[var(--border)] p-4 text-sm text-[var(--muted)]">当前申请尚未收到供应商正式报价。</p> : null}
    <div className="mt-5 grid gap-4">{records?.map((record) => <article className={orderClass} key={record.id}>
      <div><span className="font-mono text-xs text-[var(--muted)]">{record.id} · 报价版本 {record.quote.offerVersion}</span><h3 className="mb-0 mt-2 text-xl">{record.resource.title}</h3><p className="mb-0 mt-1 text-sm text-[var(--text)]">{record.resource.supplierName} · {record.resource.gpuDescription}</p><p className="mb-0 mt-3 text-sm">{record.quote.serviceSummary}</p><dl className="mt-4 grid gap-px bg-[var(--border)] sm:grid-cols-2"><div className="bg-[var(--info-bg)] p-3"><dt className="text-xs text-[var(--muted)]">正式报价</dt><dd className="m-0 mt-1 font-mono text-lg">{formatCardHourDisplayMicros(record.quote.quotedCardHourMicros)} 卡时</dd></div><div className="bg-[var(--info-bg)] p-3"><dt className="text-xs text-[var(--muted)]">卡时状态</dt><dd className="m-0 mt-1 text-sm font-semibold">{holdLabel(record)}</dd></div><div className="bg-[var(--info-bg)] p-3"><dt className="text-xs text-[var(--muted)]">预计交付</dt><dd className="m-0 mt-1 text-sm">{dateTime(record.quote.expectedDeliveryAt)}</dd></div><div className="bg-[var(--info-bg)] p-3"><dt className="text-xs text-[var(--muted)]">订单状态</dt><dd className="m-0 mt-1 text-sm font-semibold">{statusLabels[record.status]}</dd></div></dl></div>
      <div className="border-l-2 border-[var(--accent)] bg-[var(--info-bg)] p-4">
        {record.status === "OFFERED" ? <>{confirmingId !== record.id ? <button className="button button-primary w-full" onClick={() => setConfirmingId(record.id)} type="button">查看并确认锁定</button> : <div><strong>再次确认锁定卡时</strong><p className="text-sm">将锁定 {formatCardHourDisplayMicros(record.quote.quotedCardHourMicros)} 卡时。HELD 只是冻结额度，尚未扣减；最终验收后才按实际用量扣减。</p><button className="button button-primary w-full" disabled={busyId === record.id} onClick={() => void mutate(record, "accept-offer")} type="button">{busyId === record.id ? "锁定中…" : "确认报价并锁定卡时"}</button><button className="button button-secondary mt-2 w-full" onClick={() => setConfirmingId(null)} type="button">暂不锁定</button></div>}<Link className="mt-3 block text-center text-sm font-semibold text-[var(--accent)]" href="/member/card-hours">余额不足？前往我的资产充值卡时</Link></> : null}
        {record.status === "CARD_HOURS_HELD" ? <p className="m-0 text-sm"><strong>额度已锁定，尚未扣减。</strong><br />供应商现在可以开始准备资源。</p> : null}
        {record.status === "PREPARING" ? <p className="m-0 text-sm">供应商正在准备人工交付，请等待连接入口。</p> : null}
        {record.status === "READY" && record.delivery.connection ? <div><strong>核对连接入口</strong><dl className="mt-3 grid gap-2 text-sm"><div><dt>主机</dt><dd className="m-0 font-mono">{record.delivery.connection.host}</dd></div><div><dt>端口 / 用户</dt><dd className="m-0 font-mono">{record.delivery.connection.port} / {record.delivery.connection.username}</dd></div><div><dt>Host Key 指纹</dt><dd className="m-0 break-all font-mono">{record.delivery.connection.hostKeyFingerprint}</dd></div></dl><button className="button button-primary mt-4 w-full" disabled={busyId === record.id} onClick={() => void mutate(record, "confirm-connection")} type="button">{busyId === record.id ? "确认中…" : "连接可用，确认开始服务"}</button></div> : null}
        {record.status === "CONNECTION_CONFIRMED" ? <p className="m-0 text-sm">连接已确认，当前处于服务中。卡时仍是 HELD，尚未扣减。</p> : null}
        {record.status === "AWAITING_ACCEPTANCE" ? <div><strong>供应商已标记服务结束</strong><p className="text-sm">实际用量 {formatCardHourDisplayMicros(record.quote.actualCardHourMicros ?? 0)} 卡时。最终验收后扣减实际用量并释放剩余额度。</p><button className="button button-primary w-full" disabled={busyId === record.id} onClick={() => void mutate(record, "accept-completion")} type="button">{busyId === record.id ? "验收中…" : "最终验收并确认扣减"}</button><Link className="mt-3 block text-center text-sm font-semibold text-[var(--error)]" href={`/member/purchases/${encodeURIComponent(record.demandId)}#member-appeal-title`}>交付有问题？发起申诉</Link></div> : null}
        {record.status === "COMPLETED" ? <p className="m-0 text-sm"><strong>订单已完成。</strong><br />{holdLabel(record)}</p> : null}
        {record.status === "CANCELLED" ? <p className="m-0 text-sm">订单已取消，不会继续交付或扣减卡时。</p> : null}
      </div>
    </article>)}</div>
  </section>;
}

export function SupplierManualCommercialOrders() {
  const { locale } = useLocale();
  const copy = SUPPLIER_ORDER_COPY[locale];
  const [records, setRecords] = useState<ManualCommercialOrderView[] | null>(null);
  const [deliveries, setDeliveries] = useState<SupplierManualDeliveryTask[]>([]);
  const [demandId, setDemandId] = useState(""); const [quote, setQuote] = useState(""); const [summary, setSummary] = useState(""); const [expectedAt, setExpectedAt] = useState("");
  const [actualByOrder, setActualByOrder] = useState<Record<string, string>>({}); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const [ordersPayload, deliveriesPayload] = await Promise.all([marketplaceGet<OrderPayload>("/api/v1/supply/manual-orders"), marketplaceGet<DeliveryPayload>("/api/v1/supply/manual-deliveries")]);
    setRecords(Array.isArray(ordersPayload.records) ? ordersPayload.records : []); setDeliveries(Array.isArray(deliveriesPayload.records) ? deliveriesPayload.records : []);
  }, []);
  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load().catch((reason: unknown) => setError(safeSupplierOrderError(reason, copy))); }); return () => window.cancelAnimationFrame(frame); }, [copy, load]);
  const candidates = useMemo(() => deliveries.filter((item) => ["SUPPLIER_ASSIGNED", "DELIVERY_IN_PROGRESS"].includes(item.status) && !records?.some((order) => order.demandId === item.demandId)), [deliveries, records]);
  const selectedDelivery = candidates.find((item) => item.demandId === demandId);

  async function createOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const quotedCardHourMicros = parseCardHours(quote); if (!selectedDelivery || !quotedCardHourMicros) return;
    setBusy("create"); setError(""); setNotice("");
    try {
      const result = await marketplacePost<ManualCommercialOrderView>("/api/v1/supply/manual-orders", { demandId, quotedCardHourMicros, serviceSummary: summary.trim(), expectedDeliveryAt: expectedAt ? new Date(expectedAt).toISOString() : undefined, expectedDeliveryStatusVersion: selectedDelivery.statusVersion }, createIdempotencyKey("manual-order-offer"));
      setRecords((current) => [result.record, ...(current ?? [])]); setDemandId(""); setQuote(""); setSummary(""); setExpectedAt(""); setNotice(copy.offerSaved);
    } catch (reason) { if (reason instanceof MarketplaceApiError && reason.status === 409) { await load().catch(() => undefined); setError(copy.deliveryConflict); } else setError(safeSupplierOrderError(reason, copy)); } finally { setBusy(null); }
  }

  async function mutate(record: ManualCommercialOrderView, action: "prepare" | "ready" | "service-complete") {
    const actualCardHourMicros = action === "service-complete" ? parseCardHours(actualByOrder[record.id] ?? "") : null;
    if (action === "service-complete" && (!actualCardHourMicros || actualCardHourMicros > record.hold.heldMicros)) { setError(copy.invalidActual); return; }
    setBusy(record.id); setError(""); setNotice("");
    try {
      const result = await marketplacePost<ManualCommercialOrderView>(`/api/v1/supply/manual-orders/${encodeURIComponent(record.id)}/${action}`, { expectedVersion: record.version, ...(actualCardHourMicros ? { actualCardHourMicros } : {}) }, createIdempotencyKey(`manual-order-${action}`));
      setRecords((current) => current?.map((item) => item.id === result.record.id ? result.record : item) ?? [result.record]); setNotice(copy.updated);
    } catch (reason) { if (reason instanceof MarketplaceApiError && reason.status === 409) { await load().catch(() => undefined); setError(copy.orderConflict); } else setError(safeSupplierOrderError(reason, copy)); } finally { setBusy(null); }
  }

  return <section className={sectionClass} aria-labelledby="supplier-manual-orders-title"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="kicker">MANUAL ORDER FULFILLMENT</p><h2 className="m-0 text-2xl" id="supplier-manual-orders-title">{copy.title}</h2><p className="mb-0 mt-2 text-sm text-[var(--muted)]">{copy.description}</p></div><button className="button button-secondary" onClick={() => void load()} type="button">{copy.refresh}</button></div>
    {candidates.length ? <form className="mt-5 grid gap-4 border border-[var(--border)] bg-[var(--info-bg)] p-4 md:grid-cols-2" onSubmit={createOffer}><label className="grid gap-2 text-sm font-semibold">{copy.demand}<select className="min-h-11 border border-[var(--border-strong)] bg-[var(--surface)] p-2" required value={demandId} onChange={(event) => setDemandId(event.target.value)}><option value="">{copy.choose}</option>{candidates.map((item) => <option key={item.demandId} value={item.demandId}>{item.demandId} · {item.resource.title}</option>)}</select></label><label className="grid gap-2 text-sm font-semibold">{copy.quote}<input className="min-h-11 border border-[var(--border-strong)] bg-[var(--surface)] p-2" inputMode="decimal" placeholder={copy.quotePlaceholder} required value={quote} onChange={(event) => setQuote(event.target.value)} /></label><label className="grid gap-2 text-sm font-semibold md:col-span-2">{copy.summary}<textarea className="min-h-24 border border-[var(--border-strong)] bg-[var(--surface)] p-2" maxLength={2000} minLength={10} required value={summary} onChange={(event) => setSummary(event.target.value)} /></label><label className="grid gap-2 text-sm font-semibold">{copy.expected}<input className="min-h-11 border border-[var(--border-strong)] bg-[var(--surface)] p-2" type="datetime-local" value={expectedAt} onChange={(event) => setExpectedAt(event.target.value)} /></label><button className="button button-primary self-end" disabled={busy === "create" || !selectedDelivery || !parseCardHours(quote) || summary.trim().length < 10} type="submit">{busy === "create" ? copy.submitting : copy.submit}</button></form> : null}
    {error ? <p className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">{error}</p> : null}{notice ? <p className="mt-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4" role="status">{notice}</p> : null}
    <div className="mt-5 grid gap-4">{records?.map((record) => <article className={orderClass} key={record.id}><div><span className="font-mono text-xs text-[var(--muted)]">{record.id} · {record.demandId} · {copy.offerVersion} {record.quote.offerVersion}</span><h3 className="mb-0 mt-2 text-xl">{record.resource.title}</h3><p className="mb-0 mt-1 text-sm">{copy.statuses[record.status]}</p><dl className="mt-4 grid gap-2 text-sm"><div><dt>{copy.quoteLabel}</dt><dd className="m-0 font-mono">{formatCardHourDisplayMicros(record.quote.quotedCardHourMicros)} {copy.cardHours}</dd></div><div><dt>{copy.funds}</dt><dd className="m-0 font-semibold">{supplierHoldLabel(record, copy)}</dd></div><div><dt>{copy.deliveryNotes}</dt><dd className="m-0">{record.quote.serviceSummary}</dd></div></dl>{record.settlement.status === "ELIGIBLE" ? <div className="mt-4 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4"><strong>{copy.receivable}: {money(record.settlement.supplierReceivableCnyCents, locale)}</strong><p className="mb-0 mt-1 text-sm">{copy.platformFee} {record.settlement.platformFeeBps === null ? "—" : `${(record.settlement.platformFeeBps / 100).toFixed(2)}%`} · {copy.payoutClosed}</p></div> : null}</div><div className="border-l-2 border-[var(--accent)] bg-[var(--info-bg)] p-4">{record.status === "OFFERED" ? <p className="m-0 text-sm">{copy.waitingBuyer}</p> : null}{record.status === "CARD_HOURS_HELD" ? <button className="button button-primary w-full" disabled={busy === record.id} onClick={() => void mutate(record, "prepare")} type="button">{copy.prepare}</button> : null}{record.status === "PREPARING" ? <div><p className="text-sm">{copy.saveConnection}</p><button className="button button-primary w-full" disabled={busy === record.id} onClick={() => void mutate(record, "ready")} type="button">{copy.connectionReady}</button></div> : null}{record.status === "READY" ? <p className="m-0 text-sm">{copy.waitingConnection}</p> : null}{record.status === "CONNECTION_CONFIRMED" ? <div><label className="grid gap-2 text-sm font-semibold">{copy.actual}<input className="min-h-11 border border-[var(--border-strong)] bg-[var(--surface)] p-2" inputMode="decimal" placeholder={formatCardHourDisplayMicros(record.hold.heldMicros)} value={actualByOrder[record.id] ?? ""} onChange={(event) => setActualByOrder((current) => ({ ...current, [record.id]: event.target.value }))} /></label><button className="button button-primary mt-3 w-full" disabled={busy === record.id || !parseCardHours(actualByOrder[record.id] ?? "")} onClick={() => void mutate(record, "service-complete")} type="button">{copy.finish}</button></div> : null}{record.status === "AWAITING_ACCEPTANCE" ? <p className="m-0 text-sm">{copy.waitingAcceptance}</p> : null}{record.status === "COMPLETED" ? <p className="m-0 text-sm">{copy.completed}</p> : null}</div></article>)}</div>
  </section>;
}

export function AdminManualCommercialOrders() {
  const [records, setRecords] = useState<ManualCommercialOrderView[] | null>(null); const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => { setError(null); try { setRecords(await adminGetRows({ path: "/api/v1/admin/manual-orders" }) as unknown as ManualCommercialOrderView[]); } catch (reason) { setError(reason); } }, []);
  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load(); }); return () => window.cancelAnimationFrame(frame); }, [load]);
  const visible = records?.filter((record) => record.status === "CANCELLED" || record.settlement.status === "ELIGIBLE") ?? [];
  return <section className="admin-manual-delivery" aria-labelledby="admin-manual-orders-title"><div className="admin-manual-delivery-head"><div><p className="admin-kicker">Manual order oversight</p><h2 id="admin-manual-orders-title">人工订单异常与结算资格</h2><span>只读视图；管理员不能在这里伪造 HELD、扣减、结算或真实出款状态。</span></div><button className="admin-button secondary" onClick={() => void load()} type="button">刷新状态</button></div>{error ? <p className="admin-inline-warning" role="alert">人工订单监督数据暂时无法读取。</p> : null}{records === null ? <p role="status">正在读取订单监督数据…</p> : null}{records !== null && visible.length === 0 ? <p className="admin-inline-warning">当前没有取消异常或已生成的供应商结算资格。</p> : null}{visible.length ? <div className="admin-table-wrap"><table className="admin-table"><caption>人工订单异常和结算资格</caption><thead><tr><th>订单</th><th>需求</th><th>状态</th><th>卡时事实</th><th>结算资格</th><th>真实出款</th></tr></thead><tbody>{visible.map((record) => <tr key={record.id}><td className="admin-mono">{record.id}</td><td className="admin-mono">{record.demandId}</td><td>{statusLabels[record.status]}</td><td>{holdLabel(record)}</td><td>{record.settlement.status === "ELIGIBLE" ? "已生成" : "未生成"}</td><td><span className="admin-status danger">CLOSED</span></td></tr>)}</tbody></table></div> : null}</section>;
}
