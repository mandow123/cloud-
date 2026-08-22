"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createIdempotencyKey, MarketplaceApiError, marketplaceErrorMessage, marketplaceGet, marketplacePost } from "@/lib/client/marketplace-client";
import type { ManualAppealCategory, ManualAppealPartyCase, ManualAppealResolution, ManualAppealStatus } from "@/lib/server/admin-store";
import styles from "./member-purchase-intents.module.css";

type AppealPayload = { records?: ManualAppealPartyCase[]; record?: ManualAppealPartyCase };

const statusLabels: Record<ManualAppealStatus, string> = {
  OPEN: "已提交，等待分流", TRIAGED: "平台已受理", AWAITING_BUYER: "等待买家补充", AWAITING_SUPPLIER: "等待供应商回复",
  UNDER_REVIEW: "平台复核中", RESOLUTION_PROPOSED: "处理建议待确认", RESOLVED: "处理建议已记录", CLOSED: "案件已关闭",
};
const categoryLabels: Record<ManualAppealCategory, string> = {
  DELIVERY_DELAY: "交付延迟", CONNECTION_FAILURE: "无法连接", SPEC_MISMATCH: "规格不符", DELIVERY_QUALITY: "交付质量",
  CANCELLATION_REQUEST: "取消申请", EXTERNAL_PAYMENT_CLAIM: "线下支付相关", OTHER: "其他问题",
};
const outcomeLabels: Record<ManualAppealResolution, string> = {
  NO_ACTION: "建议维持现状", REDELIVERY_RECOMMENDED: "建议重新交付", CANCEL_REQUEST_RECOMMENDED: "建议取消申请",
  OFFLINE_REFUND_RECOMMENDED: "建议线下退款", OTHER: "其他处理建议",
};
const authorLabels = { BUYER: "你", SUPPLIER: "供应商", ADMIN: "平台" } as const;

function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date); }
function timelineLabel(item: ManualAppealPartyCase["timeline"][number]) {
  if (item.type === "CREATE") return "申诉已提交";
  if (item.type === "TRANSITION" && item.toStatus) return `案件状态更新为“${statusLabels[item.toStatus]}”`;
  if (item.type === "MESSAGE_ADDED") return "案件新增补充说明";
  if (["REFUND_RECORD_CREATED", "OFFLINE_REFUND_TRANSITION"].includes(item.type)) return "线下处理记录已更新";
  if (item.type === "REFUND_PROOF_SUBMITTED") return "线下处理凭证已提交核验";
  if (item.type === "REFUND_PROOF_VERIFIED") return "线下处理凭证已完成独立核验";
  return "平台处理进度已更新";
}

export function MemberManualAppeals({ demandId }: { demandId: string }) {
  const [records, setRecords] = useState<ManualAppealPartyCase[] | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<ManualAppealCategory>("CONNECTION_FAILURE");
  const [subject, setSubject] = useState(""); const [description, setDescription] = useState(""); const [reply, setReply] = useState("");
  const hasActiveAppeal = records?.some((record) => record.status !== "CLOSED") ?? false;
  const load = useCallback(async () => {
    const payload = await marketplaceGet<AppealPayload>("/api/v1/member/appeals");
    const visible = Array.isArray(payload.records) ? payload.records.filter((record) => record.sourceId === demandId) : payload.record?.sourceId === demandId ? [payload.record] : [];
    setRecords(visible);
  }, [demandId]);
  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load().catch((reason: unknown) => setError(marketplaceErrorMessage(reason, "申诉记录暂时无法读取。"))); }); return () => window.cancelAnimationFrame(frame); }, [load]);

  async function createAppeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await marketplacePost<ManualAppealPartyCase>(`/api/v1/member/purchases/${encodeURIComponent(demandId)}/appeals`, { category, subject: subject.trim(), description: description.trim() }, createIdempotencyKey("member-appeal"));
      setRecords((current) => [result.record, ...(current ?? [])]); setSubject(""); setDescription(""); setNotice("申诉已提交。平台会在案件时间线中记录后续处理，不会自动退款或移动卡时。");
    } catch (reason) { setError(marketplaceErrorMessage(reason, "申诉提交失败，请稍后重试。")); } finally { setBusy(false); }
  }
  async function sendReply(record: ManualAppealPartyCase) {
    if (!reply.trim()) return; setBusy(true); setError(""); setNotice("");
    try {
      const result = await marketplacePost<ManualAppealPartyCase>(`/api/v1/member/appeals/${encodeURIComponent(record.id)}/messages`, { body: reply.trim(), expectedVersion: record.version }, createIdempotencyKey("member-appeal-message"));
      setRecords((current) => current?.map((item) => item.id === result.record.id ? result.record : item) ?? [result.record]); setReply(""); setNotice("补充说明已记录。");
    } catch (reason) {
      if (reason instanceof MarketplaceApiError && reason.status === 409) {
        await load().catch(() => undefined);
        setError("案件已被其他操作更新，已刷新为最新版本，请确认后重新提交。");
      } else setError(marketplaceErrorMessage(reason, "补充说明提交失败，请刷新案件后重试。"));
    } finally { setBusy(false); }
  }

  return <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="member-appeal-title">
    <h2 id="member-appeal-title">申诉与人工复核</h2><p className={styles.meta}>申诉只记录问题和处理建议，不会自动退款、自动移动卡时或修改支付状态。</p>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}{notice ? <p className={styles.success} role="status">{notice}</p> : null}
    {records === null ? <p className={styles.meta} role="status">正在读取申诉记录…</p> : null}
    {records !== null && !hasActiveAppeal ? <form className={styles.appealForm} onSubmit={createAppeal}>
      <label>问题类型<select value={category} onChange={(event) => setCategory(event.target.value as ManualAppealCategory)}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>申诉主题<input maxLength={120} minLength={4} required value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
      <label>问题说明<textarea maxLength={2000} minLength={10} required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="请说明发生时间、预期结果和实际情况。请勿填写私钥、密码或身份证件。" /></label>
      <button className="button button-primary" disabled={busy || subject.trim().length < 4 || description.trim().length < 10} type="submit">{busy ? "提交中…" : "发起申诉"}</button>
    </form> : null}
    {records?.map((record) => <article className={styles.appealCase} key={record.id}>
      <header><div><span className={styles.eyebrow}>{record.caseNumber}</span><h3>{record.subject}</h3></div><span className={styles.status}>{statusLabels[record.status]}</span></header>
      <dl className={styles.facts}><div><dt>问题类型</dt><dd>{categoryLabels[record.category]}</dd></div><div><dt>最近更新</dt><dd>{dateTime(record.updatedAt)}</dd></div><div><dt>平台处理建议</dt><dd>{record.partySafeResolutionOutcome ? outcomeLabels[record.partySafeResolutionOutcome] : "尚未形成处理建议"}</dd></div></dl>
      {record.partySafeResolutionSummary ? <p className={styles.deliveryNote}><strong>平台可公开处理说明</strong>{record.partySafeResolutionSummary}</p> : null}
      {record.offlineRefunds.length ? <div className={styles.appealRefunds}>{record.offlineRefunds.map((item) => {
        const verified = item.status === "INDEPENDENTLY_VERIFIED" && Boolean(item.proofVerifiedAt);
        return <p className={verified ? styles.success : styles.warning} key={item.id}><strong>{verified ? "线下退款凭证已核验" : item.status === "PROOF_SUBMITTED" ? "线下退款凭证待核验" : "线下处理记录进行中"}</strong><span>{verified ? `独立核验时间：${dateTime(item.proofVerifiedAt!)}` : "不代表资金已经退回或到账。"}</span></p>;
      })}</div> : null}
      <ol className={styles.appealTimeline} aria-label="申诉处理时间线">{record.timeline.map((item) => <li key={item.id}><strong>{timelineLabel(item)}</strong><time dateTime={item.occurredAt}>{dateTime(item.occurredAt)}</time></li>)}</ol>
      <div className={styles.appealMessages}>{record.messages.map((message) => <p key={message.id}><strong>{authorLabels[message.authorType]}</strong><span>{message.body}</span><time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time></p>)}</div>
      {record.status !== "CLOSED" ? <div className={styles.appealReply}><label htmlFor={`appeal-reply-${record.id}`}>补充说明</label><textarea id={`appeal-reply-${record.id}`} maxLength={2000} value={reply} onChange={(event) => setReply(event.target.value)} /><button className="button button-secondary" disabled={busy || !reply.trim()} onClick={() => void sendReply(record)} type="button">提交补充说明</button></div> : null}
    </article>)}
  </section>;
}
