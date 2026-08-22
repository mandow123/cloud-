"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import { createIdempotencyKey, marketplaceErrorMessage, marketplacePost } from "@/lib/client/marketplace-client";
import styles from "./member-card-hour-assets.module.css";

type TopupStatus = "PROCESSING" | "PENDING" | "CAPTURED" | "CLOSED" | "RECONCILIATION_REQUIRED";
type AppealReason = "PENDING_TIMEOUT" | "CLOSED_BUT_CHARGED" | "RECONCILIATION_REQUIRED";
type Topup = { id: string; status: TopupStatus; cardHourMicros: number; amountCents: number; appealEligibility: { canAppeal: boolean; retryAt: string | null } };
type Appeal = { id: string; caseNumber: string; topupOrderId: string; reason: AppealReason; description: string; status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED"; resolutionNote: string | null; unread: boolean; createdAt: string; updatedAt: string };

const statusLabels: Record<Appeal["status"], string> = { OPEN: "已提交", UNDER_REVIEW: "人工核对中", RESOLVED: "已形成处理结论", CLOSED: "已关闭" };

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
  const [topup, setTopup] = useState<Topup | null>(null);
  const [record, setRecord] = useState<Appeal | null>(null);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef(createIdempotencyKey("card-hour-topup-appeal"));
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/v1/member/card-hours/topups/${encodeURIComponent(orderId)}/appeal`, { credentials: "same-origin", cache: "no-store", signal });
    const payload = await response.json().catch(() => null) as { topup?: Topup; record?: Appeal | null; error?: { message?: string } } | null;
    if (!response.ok || !payload?.topup) throw new Error(payload?.error?.message ?? "充值申诉信息暂时无法读取。");
    setTopup(payload.topup); setRecord(payload.record ?? null);
    if (payload.record?.unread) {
      void marketplacePost<Appeal>(`/api/v1/member/card-hours/topups/${encodeURIComponent(orderId)}/appeal/read`, {}, createIdempotencyKey("card-hour-topup-appeal-read"))
        .then((result) => setRecord(result.record))
        .catch(() => undefined);
    }
  }, [orderId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "充值申诉信息暂时无法读取。")).finally(() => setLoading(false)); return () => controller.abort(); }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = topup ? reasonFor(topup.status) : null;
    if (!reason) return;
    setSubmitting(true); setError("");
    try {
      const result = await marketplacePost<Appeal>(`/api/v1/member/card-hours/topups/${encodeURIComponent(orderId)}/appeal`, { reason, description: description.trim() }, idempotencyKey.current);
      setRecord(result.record); setDescription("");
    } catch (reasonValue) { setError(marketplaceErrorMessage(reasonValue, "充值申诉提交失败，请稍后重试。")); }
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
