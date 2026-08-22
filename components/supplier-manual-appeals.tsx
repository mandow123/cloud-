"use client";

import { useCallback, useEffect, useState } from "react";
import { createIdempotencyKey, MarketplaceApiError, marketplaceErrorMessage, marketplaceGet, marketplacePost } from "@/lib/client/marketplace-client";
import type { ManualAppealPartyCase, ManualAppealResolution, ManualAppealStatus } from "@/lib/server/admin-store";
import styles from "./supplier-manual-deliveries.module.css";

const statusLabels: Record<ManualAppealStatus, string> = {
  OPEN: "等待平台受理", TRIAGED: "平台已受理", AWAITING_BUYER: "等待买家补充", AWAITING_SUPPLIER: "等待本组织回复",
  UNDER_REVIEW: "平台复核中", RESOLUTION_PROPOSED: "处理建议待确认", RESOLVED: "处理建议已记录", CLOSED: "案件已关闭",
};
const outcomeLabels: Record<ManualAppealResolution, string> = {
  NO_ACTION: "建议维持现状", REDELIVERY_RECOMMENDED: "建议重新交付", CANCEL_REQUEST_RECOMMENDED: "建议取消申请",
  OFFLINE_REFUND_RECOMMENDED: "建议线下退款", OTHER: "其他处理建议",
};
const authorLabels = { BUYER: "买家", SUPPLIER: "本组织", ADMIN: "平台" } as const;

function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date); }
function timelineLabel(item: ManualAppealPartyCase["timeline"][number]) {
  if (item.type === "CREATE") return "买家已提交申诉";
  if (item.type === "TRANSITION" && item.toStatus) return `案件状态更新为“${statusLabels[item.toStatus]}”`;
  if (item.type === "MESSAGE_ADDED") return "案件新增补充说明";
  if (["REFUND_RECORD_CREATED", "OFFLINE_REFUND_TRANSITION"].includes(item.type)) return "线下处理记录已更新";
  if (item.type === "REFUND_PROOF_SUBMITTED") return "线下处理凭证已提交核验";
  if (item.type === "REFUND_PROOF_VERIFIED") return "线下处理凭证已完成独立核验";
  return "平台处理进度已更新";
}

export function SupplierManualAppeals() {
  const [records, setRecords] = useState<ManualAppealPartyCase[] | null>(null); const [replyByCase, setReplyByCase] = useState<Record<string, string>>({});
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busyCase, setBusyCase] = useState<string | null>(null);
  const load = useCallback(async () => {
    const payload = await marketplaceGet<{ records?: ManualAppealPartyCase[] }>("/api/v1/supply/appeals");
    setRecords(Array.isArray(payload.records) ? payload.records : []);
  }, []);
  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load().catch((reason: unknown) => setError(marketplaceErrorMessage(reason, "关联申诉暂时无法读取。"))); }); return () => window.cancelAnimationFrame(frame); }, [load]);
  async function reply(record: ManualAppealPartyCase) {
    const body = replyByCase[record.id]?.trim(); if (!body) return; setBusyCase(record.id); setError(""); setNotice("");
    try {
      const result = await marketplacePost<ManualAppealPartyCase>(`/api/v1/supply/appeals/${encodeURIComponent(record.id)}/messages`, { body, expectedVersion: record.version }, createIdempotencyKey("supplier-appeal-message"));
      setRecords((current) => current?.map((item) => item.id === result.record.id ? result.record : item) ?? [result.record]); setReplyByCase((current) => ({ ...current, [record.id]: "" })); setNotice("供应商回复已记录，平台和买家可在案件中查看。");
    } catch (reason) {
      if (reason instanceof MarketplaceApiError && reason.status === 409) {
        await load().catch(() => undefined);
        setError("案件已被其他操作更新，已刷新为最新版本，请确认后重新提交。");
      } else setError(marketplaceErrorMessage(reason, "回复提交失败，请刷新案件后重试。"));
    } finally { setBusyCase(null); }
  }
  return <section className={styles.appeals} aria-labelledby="supplier-appeals-title">
    <header className={styles.head}><div><p>ASSOCIATED APPEALS</p><h2 id="supplier-appeals-title">关联交付申诉</h2><span>仅显示分配给当前供应组织的脱敏案件；不包含买家姓名、邮箱、SSH 原文或平台内部备注。</span></div><button className="button button-secondary" onClick={() => void load()} type="button">刷新申诉</button></header>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}{notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {records === null ? <p className={styles.empty} role="status">正在读取关联申诉…</p> : null}{records?.length === 0 ? <p className={styles.empty}>当前没有关联申诉。</p> : null}
    {records?.map((record) => <article className={styles.appeal} key={record.id}>
      <header><div><span>{record.caseNumber} · {record.sourceId}</span><h3>{record.subject}</h3><p>{record.resource?.title ?? "人工交付任务"}</p></div><strong>{statusLabels[record.status]}</strong></header>
      {record.partySafeResolutionOutcome ? <p className={styles.boundary}><strong>{outcomeLabels[record.partySafeResolutionOutcome]}</strong>{record.partySafeResolutionSummary ? ` · ${record.partySafeResolutionSummary}` : ""}</p> : null}
      {record.offlineRefunds.map((item) => {
        const verified = item.status === "INDEPENDENTLY_VERIFIED" && Boolean(item.proofVerifiedAt);
        return <p className={styles.boundary} key={item.id}><strong>{verified ? "线下退款凭证已核验" : item.status === "PROOF_SUBMITTED" ? "线下退款凭证待核验" : "线下处理记录进行中"}</strong> · {verified ? dateTime(item.proofVerifiedAt!) : "不代表资金已经退回或到账"}</p>;
      })}
      <ol className={styles.appealTimeline} aria-label="申诉处理时间线">{record.timeline.map((item) => <li key={item.id}><strong>{timelineLabel(item)}</strong><time dateTime={item.occurredAt}>{dateTime(item.occurredAt)}</time></li>)}</ol>
      <div className={styles.appealMessages}>{record.messages.map((message) => <p key={message.id}><strong>{authorLabels[message.authorType]}</strong><span>{message.body}</span><time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time></p>)}</div>
      {record.status !== "CLOSED" ? <div className={styles.appealReply}><label htmlFor={`supplier-appeal-${record.id}`}>供应商回复</label><textarea id={`supplier-appeal-${record.id}`} maxLength={2000} value={replyByCase[record.id] ?? ""} onChange={(event) => setReplyByCase((current) => ({ ...current, [record.id]: event.target.value }))} /><button className="button button-secondary" disabled={busyCase === record.id || !replyByCase[record.id]?.trim()} onClick={() => void reply(record)} type="button">{busyCase === record.id ? "提交中…" : "提交回复"}</button></div> : null}
    </article>)}
  </section>;
}
