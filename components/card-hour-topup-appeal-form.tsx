"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import { createIdempotencyKey, MarketplaceApiError, marketplacePost, safeMarketplaceErrorMessage } from "@/lib/client/marketplace-client";
import type { Locale } from "@/lib/i18n";
import styles from "./member-card-hour-assets.module.css";

type TopupStatus = "PROCESSING" | "PENDING" | "CAPTURED" | "CLOSED" | "RECONCILIATION_REQUIRED";
type AppealReason = "PENDING_TIMEOUT" | "CLOSED_BUT_CHARGED" | "RECONCILIATION_REQUIRED";
type Topup = { id: string; status: TopupStatus; cardHourMicros: number; amountCents: number; appealEligibility: { canAppeal: boolean; retryAt: string | null } };
type Appeal = { id: string; caseNumber: string; topupOrderId: string; reason: AppealReason; description: string; status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED"; resolutionNote: string | null; unread: boolean; createdAt: string; updatedAt: string };

const statusLabels: Record<Appeal["status"], string> = { OPEN: "已提交", UNDER_REVIEW: "人工核对中", RESOLVED: "已形成处理结论", CLOSED: "已关闭" };

type AppealErrorCopy = Readonly<{ load: string; notFound: string; unavailable: string; submit: string; requestId: string; retry: (seconds: number) => string }>;
const APPEAL_ERROR_COPY: Record<Locale, AppealErrorCopy> = {
  "zh-CN": { load: "充值申诉信息暂时无法读取。", notFound: "没有找到对应的充值记录。", unavailable: "当前付款单状态不能发起申诉。", submit: "充值申诉提交失败，请稍后重试。", requestId: "请求编号", retry: (seconds) => `可在 ${seconds} 秒后重试。` },
  "zh-TW": { load: "目前無法讀取儲值申訴資料。", notFound: "找不到對應的儲值記錄。", unavailable: "目前付款單狀態無法提出申訴。", submit: "儲值申訴提交失敗，請稍後再試。", requestId: "請求編號", retry: (seconds) => `可於 ${seconds} 秒後重試。` },
  en: { load: "The top-up appeal cannot be loaded right now.", notFound: "The top-up record was not found.", unavailable: "This payment order is not eligible for an appeal.", submit: "The top-up appeal could not be submitted. Try again later.", requestId: "Request ID", retry: (seconds) => `Try again in ${seconds} seconds.` },
  ja: { load: "現在、チャージ申立てを読み込めません。", notFound: "チャージ記録が見つかりません。", unavailable: "この支払い注文は申立ての対象外です。", submit: "申立てを送信できません。後でもう一度お試しください。", requestId: "リクエスト ID", retry: (seconds) => `${seconds} 秒後に再試行できます。` },
  ko: { load: "현재 충전 이의제기 정보를 불러올 수 없습니다.", notFound: "충전 기록을 찾을 수 없습니다.", unavailable: "현재 결제 주문은 이의제기 대상이 아닙니다.", submit: "충전 이의제기를 제출하지 못했습니다. 나중에 다시 시도하세요.", requestId: "요청 ID", retry: (seconds) => `${seconds}초 후 다시 시도하세요.` },
  fr: { load: "La contestation de recharge est momentanément indisponible.", notFound: "La recharge demandée est introuvable.", unavailable: "Cet ordre de paiement ne peut pas être contesté.", submit: "Impossible d’envoyer la contestation. Réessayez plus tard.", requestId: "ID de requête", retry: (seconds) => `Réessayez dans ${seconds} secondes.` },
  th: { load: "ยังไม่สามารถโหลดข้อมูลคำร้องการเติมได้", notFound: "ไม่พบรายการเติมที่ร้องขอ", unavailable: "สถานะรายการชำระนี้ยังยื่นคำร้องไม่ได้", submit: "ส่งคำร้องไม่สำเร็จ โปรดลองอีกครั้งภายหลัง", requestId: "รหัสคำขอ", retry: (seconds) => `ลองอีกครั้งใน ${seconds} วินาที` },
  vi: { load: "Hiện không thể tải khiếu nại nạp tiền.", notFound: "Không tìm thấy bản ghi nạp tiền.", unavailable: "Đơn thanh toán này không đủ điều kiện khiếu nại.", submit: "Không thể gửi khiếu nại. Hãy thử lại sau.", requestId: "ID yêu cầu", retry: (seconds) => `Thử lại sau ${seconds} giây.` },
  id: { load: "Banding isi ulang belum dapat dimuat.", notFound: "Catatan isi ulang tidak ditemukan.", unavailable: "Pesanan pembayaran ini tidak dapat diajukan banding.", submit: "Banding gagal dikirim. Coba lagi nanti.", requestId: "ID permintaan", retry: (seconds) => `Coba lagi dalam ${seconds} detik.` },
  ms: { load: "Rayuan tambah nilai belum dapat dimuatkan.", notFound: "Rekod tambah nilai tidak ditemui.", unavailable: "Pesanan bayaran ini tidak layak untuk rayuan.", submit: "Rayuan gagal dihantar. Cuba lagi kemudian.", requestId: "ID permintaan", retry: (seconds) => `Cuba lagi dalam ${seconds} saat.` },
};

function safeRequestId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function money(cents: number) { return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100); }
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date); }
function reasonFor(status: TopupStatus): AppealReason | null {
  if (status === "PENDING" || status === "PROCESSING") return "PENDING_TIMEOUT";
  if (status === "CLOSED") return "CLOSED_BUT_CHARGED";
  if (status === "RECONCILIATION_REQUIRED") return "RECONCILIATION_REQUIRED";
  return null;
}
function reasonLabel(reason: AppealReason) {
  if (reason === "PENDING_TIMEOUT") return "长时间未确认支付结果";
  if (reason === "CLOSED_BUT_CHARGED") return "付款单已关闭，但我确认资金已扣除";
  return "付款单显示待人工核对";
}

export function CardHourTopupAppealForm({ orderId }: { orderId: string }) {
  const { locale } = useLocale();
  const errorCopy = APPEAL_ERROR_COPY[locale];
  const [topup, setTopup] = useState<Topup | null>(null);
  const [record, setRecord] = useState<Appeal | null>(null);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef(createIdempotencyKey("card-hour-topup-appeal"));
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/v1/member/card-hours/topups/${encodeURIComponent(orderId)}/appeal`, { credentials: "same-origin", cache: "no-store", signal });
    const payload = await response.json().catch(() => null) as { topup?: Topup; record?: Appeal | null; error?: { code?: unknown; requestId?: unknown } } | null;
    if (!response.ok || !payload?.topup) throw new MarketplaceApiError({
      code: typeof payload?.error?.code === "string" ? payload.error.code : response.ok ? "INVALID_RESPONSE" : `HTTP_${response.status}`,
      message: "REQUEST_FAILED",
      requestId: safeRequestId(payload?.error?.requestId),
      status: response.status,
    });
    setTopup(payload.topup); setRecord(payload.record ?? null);
    if (payload.record?.unread) {
      void marketplacePost<Appeal>(`/api/v1/member/card-hours/topups/${encodeURIComponent(orderId)}/appeal/read`, {}, createIdempotencyKey("card-hour-topup-appeal-read"))
        .then((result) => setRecord(result.record))
        .catch(() => undefined);
    }
  }, [orderId]);
  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => {
      void load(controller.signal)
        .catch((reason: unknown) => setError(safeMarketplaceErrorMessage(reason, errorCopy.load, { requestIdLabel: errorCopy.requestId, retryAfter: errorCopy.retry, allowlistedMessages: { NOT_FOUND: errorCopy.notFound, TOPUP_NOT_FOUND: errorCopy.notFound, APPEAL_NOT_AVAILABLE: errorCopy.unavailable } })))
        .finally(() => setLoading(false));
    });
    return () => { window.cancelAnimationFrame(frame); controller.abort(); };
  }, [errorCopy, load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = topup ? reasonFor(topup.status) : null;
    if (!reason) return;
    setSubmitting(true); setError("");
    try {
      const result = await marketplacePost<Appeal>(`/api/v1/member/card-hours/topups/${encodeURIComponent(orderId)}/appeal`, { reason, description: description.trim() }, idempotencyKey.current);
      setRecord(result.record); setDescription("");
    } catch (reasonValue) { setError(safeMarketplaceErrorMessage(reasonValue, errorCopy.submit, { requestIdLabel: errorCopy.requestId, retryAfter: errorCopy.retry, allowlistedMessages: { NOT_FOUND: errorCopy.notFound, TOPUP_NOT_FOUND: errorCopy.notFound, APPEAL_NOT_AVAILABLE: errorCopy.unavailable } })); }
    finally { setSubmitting(false); }
  }
  if (loading) return <div className={styles.returnPage}><section className={styles.returnPanel} role="status">正在读取付款单和申诉记录…</section></div>;
  if (!topup) return <div className={styles.returnPage}><section className={styles.returnPanel} role="alert"><p className={styles.eyebrow}>PAYMENT APPEAL</p><h1>充值申诉无法打开</h1><p>{error || "充值记录不存在。"}</p><div className={styles.actions}><Link className={styles.secondaryAction} href="/member/card-hours">返回我的资产</Link></div></section></div>;
  return <div className={styles.returnPage}><section className={styles.returnPanel} aria-labelledby="topup-appeal-title">
    <p className={styles.eyebrow}>PAYMENT APPEAL</p><h1 id="topup-appeal-title">充值遇到问题</h1>
    <p>平台会按付款单人工核对，不会因为提交申诉自动退款、自动入账或修改支付状态。</p>
    <dl className={styles.returnFacts}><div><dt>付款单</dt><dd>{topup.id}</dd></div><div><dt>充值卡时</dt><dd>{formatCardHourDisplayMicros(topup.cardHourMicros)}</dd></div><div><dt>支付金额</dt><dd>{money(topup.amountCents)}</dd></div><div><dt>问题类型</dt><dd>{reasonFor(topup.status) ? reasonLabel(reasonFor(topup.status)!) : "当前状态无需申诉"}</dd></div></dl>
    {record ? <div className={styles.success} role="status"><strong>{record.unread ? "新进展 · " : ""}申诉编号：{record.caseNumber}</strong><br />状态：{statusLabels[record.status]} · 更新于 {dateTime(record.updatedAt)}{record.resolutionNote ? <><br />人工结论：{record.resolutionNote}</> : null}</div> : reasonFor(topup.status) && topup.appealEligibility.canAppeal ? <form className={styles.appealForm} onSubmit={submit}><label htmlFor="topup-appeal-description">补充说明</label><textarea id="topup-appeal-description" maxLength={2000} minLength={10} onChange={(event) => setDescription(event.target.value)} placeholder="请说明扣款时间、当前页面状态和需要平台核对的问题；不要填写支付密码或完整银行卡号。" required value={description} /><button className={styles.primaryAction} disabled={submitting || description.trim().length < 10} type="submit">{submitting ? "提交中…" : "提交充值申诉"}</button></form> : topup.appealEligibility.retryAt ? <p className={styles.notice}>支付结果仍在正常确认时间内，暂时无需申诉。若届时仍未更新，请在 {dateTime(topup.appealEligibility.retryAt)} 后重试。</p> : <p className={styles.notice}>该付款单已经到账，不需要发起充值申诉。</p>}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <div className={styles.actions}><Link className={styles.secondaryAction} href={`/member/card-hours/topups/${encodeURIComponent(orderId)}/return`}>返回付款单状态</Link><Link className={styles.secondaryAction} href="/member/card-hours">返回我的资产</Link></div>
  </section></div>;
}
