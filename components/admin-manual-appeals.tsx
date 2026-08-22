"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminApiError, adminErrorMessage, adminGetJson, adminGetRows, adminPostAction } from "@/components/admin-api-client";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin-states";
import type { AdminManualAppealCase, ManualAppealResolution, ManualAppealStatus } from "@/lib/server/admin-store";

type TransitionAction = "TRIAGE" | "REQUEST_BUYER" | "REQUEST_SUPPLIER" | "START_REVIEW" | "PROPOSE_RESOLUTION" | "RESOLVE" | "CLOSE" | "REOPEN_REVIEW";
const statusLabels: Record<ManualAppealStatus, string> = {
  OPEN: "待分流", TRIAGED: "已受理", AWAITING_BUYER: "等待买家补充", AWAITING_SUPPLIER: "等待供应商回复", UNDER_REVIEW: "复核中",
  RESOLUTION_PROPOSED: "处理建议待确认", RESOLVED: "处理建议已记录", CLOSED: "已关闭",
};
const transitionLabels: Record<TransitionAction, string> = {
  TRIAGE: "受理并分流", REQUEST_BUYER: "请求买家补充", REQUEST_SUPPLIER: "请求供应商回复", START_REVIEW: "开始平台复核",
  PROPOSE_RESOLUTION: "提出处理建议", RESOLVE: "记录处理结论", CLOSE: "关闭案件", REOPEN_REVIEW: "重新进入复核",
};
const outcomeLabels: Record<ManualAppealResolution, string> = {
  NO_ACTION: "建议维持现状", REDELIVERY_RECOMMENDED: "建议重新交付", CANCEL_REQUEST_RECOMMENDED: "建议取消申请", OFFLINE_REFUND_RECOMMENDED: "建议线下退款", OTHER: "其他处理建议",
};
const allowedActions: Record<ManualAppealStatus, TransitionAction[]> = {
  OPEN: ["TRIAGE"], TRIAGED: ["REQUEST_BUYER", "REQUEST_SUPPLIER", "START_REVIEW"], AWAITING_BUYER: ["START_REVIEW"], AWAITING_SUPPLIER: ["START_REVIEW"],
  UNDER_REVIEW: ["REQUEST_BUYER", "REQUEST_SUPPLIER", "PROPOSE_RESOLUTION"], RESOLUTION_PROPOSED: ["RESOLVE", "REOPEN_REVIEW"], RESOLVED: ["CLOSE", "REOPEN_REVIEW"], CLOSED: [],
};
function dateTime(value: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN"); }
function recordFrom(payload: Record<string, unknown>) { if (!payload.record || typeof payload.record !== "object" || Array.isArray(payload.record)) throw new AdminApiError("申诉接口返回格式无效。", 200, "INVALID_RESPONSE"); return payload.record as AdminManualAppealCase; }
function timelineLabel(item: AdminManualAppealCase["timeline"][number]) {
  if (item.type === "CREATE") return "买家提交申诉";
  if (item.type === "TRANSITION" && item.toStatus) return `状态更新为“${statusLabels[item.toStatus]}”`;
  if (item.type === "MESSAGE_ADDED") return "新增案件消息";
  if (item.type === "ASSIGN") return "案件完成分配";
  if (item.type === "REFUND_RECORD_CREATED") return "线下处理记录已创建";
  if (item.type === "REFUND_PROOF_SUBMITTED") return "线下处理凭证已提交核验";
  if (item.type === "REFUND_PROOF_VERIFIED") return "线下处理凭证已完成独立核验";
  if (item.type === "OFFLINE_REFUND_TRANSITION") return "线下处理记录状态已更新";
  return "案件处理进度已更新";
}

export function AdminManualAppeals() {
  const [rows, setRows] = useState<AdminManualAppealCase[]>([]); const [selected, setSelected] = useState<AdminManualAppealCase | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<TransitionAction | "">(""); const [outcome, setOutcome] = useState<ManualAppealResolution>("NO_ACTION"); const [resolutionSummary, setResolutionSummary] = useState("");
  const [messageBody, setMessageBody] = useState(""); const [visibility, setVisibility] = useState<"PARTIES" | "ADMIN_ONLY">("PARTIES");
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const records = await adminGetRows({ path: "/api/v1/admin/appeals" }) as unknown as AdminManualAppealCase[]; setRows(records); setSelected((current) => current ? records.find((record) => record.id === current.id) ?? current : null); }
    catch (reason) { setError(reason); } finally { setLoading(false); }
  }, []);
  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load(); }); return () => window.cancelAnimationFrame(frame); }, [load]);
  async function selectCase(caseId: string) { setError(null); setNotice(""); try { const record = recordFrom(await adminGetJson(`/api/v1/admin/appeals/${encodeURIComponent(caseId)}`)); setSelected(record); setAction(allowedActions[record.status][0] ?? ""); } catch (reason) { setError(reason); } }
  function updateRecord(record: AdminManualAppealCase) { setSelected(record); setRows((current) => current.map((item) => item.id === record.id ? record : item)); setAction(allowedActions[record.status][0] ?? ""); }
  async function transition() {
    if (!selected || !action) return; setBusy(true); setError(null); setNotice("");
    const proposing = action === "PROPOSE_RESOLUTION";
    try {
      const record = recordFrom(await adminPostAction(`/api/v1/admin/appeals/${encodeURIComponent(selected.id)}/transition`, { action, expectedVersion: selected.version, resolutionOutcome: proposing ? outcome : undefined, resolutionSummary: proposing ? resolutionSummary.trim() : undefined }));
      updateRecord(record); setResolutionSummary(""); setNotice(`案件已更新为“${statusLabels[record.status]}”。`);
    } catch (reason) { setError(reason); } finally { setBusy(false); }
  }
  async function addMessage() {
    if (!selected || !messageBody.trim()) return; setBusy(true); setError(null); setNotice("");
    try { const record = recordFrom(await adminPostAction(`/api/v1/admin/appeals/${encodeURIComponent(selected.id)}/messages`, { body: messageBody.trim(), visibility, expectedVersion: selected.version })); updateRecord(record); setMessageBody(""); setNotice(visibility === "PARTIES" ? "公开处理消息已记录。" : "管理员内部消息已记录。 "); }
    catch (reason) {
      if (reason instanceof AdminApiError && reason.status === 409) {
        await selectCase(selected.id);
        setNotice("案件已被其他操作更新，请确认最新版本后重新提交。");
      } else setError(reason);
    } finally { setBusy(false); }
  }

  return <section className="admin-appeals" aria-labelledby="admin-appeals-title">
    <header className="admin-manual-delivery-head"><div><p className="admin-kicker">Manual appeals</p><h1 id="admin-appeals-title">人工申诉案件</h1><span>申诉、处理建议和线下退款凭证彼此独立；本页不提供自动退款、卡时移动或支付状态修改。</span></div><button className="admin-button secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? "读取中…" : "刷新案件"}</button></header>
    {loading && rows.length === 0 ? <AdminLoading /> : null}{error ? <AdminError message={adminErrorMessage(error, "申诉案件暂时无法处理。 ")} onRetry={() => void load()} /> : null}
    {!loading && !error && rows.length === 0 ? <AdminEmpty description="买家针对人工交付申请发起申诉后，案件会出现在这里。" title="暂无申诉案件" /> : null}
    {rows.length ? <div className="admin-table-wrap"><table className="admin-table"><caption>人工申诉案件</caption><thead><tr><th>案件</th><th>来源申请</th><th>主题</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{rows.map((record) => <tr key={record.id}><td className="admin-mono">{record.caseNumber}</td><td className="admin-mono">{record.sourceId}</td><td>{record.subject}</td><td><span className={`admin-status ${record.status === "CLOSED" ? "success" : "warning"}`}>{statusLabels[record.status]}</span></td><td>{dateTime(record.updatedAt)}</td><td><button className="admin-button secondary" onClick={() => void selectCase(record.id)} type="button">查看与处理</button></td></tr>)}</tbody></table></div> : null}
    {selected ? <section className="admin-action-panel admin-appeal-detail"><div><p className="admin-kicker">{selected.caseNumber}</p><h2>{selected.subject}</h2><span>{selected.sourceId} · {statusLabels[selected.status]} · 版本 {selected.version}</span><p>{selected.description}</p><dl className="admin-manual-timeline"><div><dt>创建</dt><dd>{dateTime(selected.createdAt)}</dd></div><div><dt>更新</dt><dd>{dateTime(selected.updatedAt)}</dd></div><div><dt>处理建议</dt><dd>{selected.partySafeResolutionOutcome ? outcomeLabels[selected.partySafeResolutionOutcome] : "尚未形成"}</dd></div></dl>{selected.partySafeResolutionSummary ? <p><small>双方可见处理说明</small><br />{selected.partySafeResolutionSummary}</p> : null}<ol className="admin-appeal-timeline" aria-label="申诉处理时间线">{selected.timeline.map((item) => <li key={item.id}><strong>{timelineLabel(item)}</strong><time dateTime={item.occurredAt}>{dateTime(item.occurredAt)}</time></li>)}</ol></div>
      <div className="admin-action-fields">
        {allowedActions[selected.status].length ? <><label><span>案件动作</span><select value={action} onChange={(event) => setAction(event.target.value as TransitionAction)}>{allowedActions[selected.status].map((value) => <option key={value} value={value}>{transitionLabels[value]}</option>)}</select></label>{action === "PROPOSE_RESOLUTION" ? <><label><span>处理建议</span><select value={outcome} onChange={(event) => setOutcome(event.target.value as ManualAppealResolution)}>{Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>双方可见处理说明</span><textarea value={resolutionSummary} onChange={(event) => setResolutionSummary(event.target.value)} /></label></> : null}<button className="admin-button primary" disabled={busy || (action === "PROPOSE_RESOLUTION" && resolutionSummary.trim().length < 10)} onClick={() => void transition()} type="button">{busy ? "处理中…" : action ? transitionLabels[action] : "选择案件动作"}</button></> : <p>该案件当前没有可执行状态动作。</p>}
        <label><span>消息可见范围</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as "PARTIES" | "ADMIN_ONLY")}><option value="PARTIES">买家与供应商可见</option><option value="ADMIN_ONLY">仅管理员可见</option></select></label><label><span>处理消息</span><textarea value={messageBody} onChange={(event) => setMessageBody(event.target.value)} /></label><button className="admin-button secondary" disabled={busy || !messageBody.trim()} onClick={() => void addMessage()} type="button">记录消息</button>
        <div className="admin-appeal-messages">{selected.messages.map((message) => <p key={message.id}><strong>{message.authorType} · {message.visibility === "ADMIN_ONLY" ? "仅管理员" : "双方可见"}</strong><span>{message.body}</span><time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time></p>)}</div>
        {selected.offlineRefunds.length ? <div className="admin-appeal-refunds"><strong>线下处理凭证（只读）</strong>{selected.offlineRefunds.map((item) => { const verified = item.status === "INDEPENDENTLY_VERIFIED" && Boolean(item.proofVerifiedAt); return <p key={item.id}><strong>{verified ? "线下退款凭证已核验" : item.status === "PROOF_SUBMITTED" ? "线下退款凭证待核验" : "线下处理记录进行中"}</strong><span>{verified ? `独立核验时间：${dateTime(item.proofVerifiedAt)}` : "不得据此认定资金已经退回或到账。"}</span></p>; })}</div> : <p className="admin-inline-warning">当前没有独立核验后的线下退款凭证，不能认定资金已经退回。</p>}
        {notice ? <div className="admin-inline-success" role="status"><strong>操作完成</strong><span>{notice}</span></div> : null}
      </div></section> : null}
  </section>;
}
