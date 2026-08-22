"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { adminErrorMessage, adminGetJson, adminPostAction } from "@/components/admin-api-client";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin-states";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import type { CardHourTopupAppealRecord, CardHourTopupAppealStatus } from "@/lib/server/card-hour-store";

type Action = "START_REVIEW" | "RESOLVE" | "CLOSE";
const statusLabels: Record<CardHourTopupAppealStatus, string> = { OPEN: "待人工受理", UNDER_REVIEW: "人工核对中", RESOLVED: "已形成结论", CLOSED: "已关闭" };
const actionLabels: Record<Action, string> = { START_REVIEW: "开始人工核对", RESOLVE: "记录核对结论", CLOSE: "关闭案件" };
const allowedAction: Record<CardHourTopupAppealStatus, Action | null> = { OPEN: "START_REVIEW", UNDER_REVIEW: "RESOLVE", RESOLVED: "CLOSE", CLOSED: null };
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN"); }
function money(cents: number) { return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100); }

export function AdminCardHourTopupAppeals() {
  const [records, setRecords] = useState<CardHourTopupAppealRecord[]>([]);
  const [selected, setSelected] = useState<CardHourTopupAppealRecord | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [draftStatus, setDraftStatus] = useState("");
  const [draftOrderId, setDraftOrderId] = useState("");
  const [draftOrganizationId, setDraftOrganizationId] = useState("");
  const [filters, setFilters] = useState({ status: "", orderId: "", organizationId: "" });
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (filters.status) params.set("status", filters.status);
      if (filters.orderId) params.set("orderId", filters.orderId);
      if (filters.organizationId) params.set("organizationId", filters.organizationId);
      const payload = await adminGetJson(`/api/v1/admin/card-hour-topup-appeals?${params.toString()}`);
      const rows = Array.isArray(payload.records) ? payload.records as CardHourTopupAppealRecord[] : [];
      setRecords(rows); setTotal(Number(payload.total ?? 0)); setTotalPages(Math.max(1, Number(payload.totalPages ?? 1)));
      setSelected((current) => current ? rows.find((item) => item.id === current.id) ?? null : null);
    } catch (reason) { setError(reason); } finally { setLoading(false); }
  }, [filters, page, pageSize]);
  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load(); }); return () => window.cancelAnimationFrame(frame); }, [load]);
  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPage(1); setFilters({ status: draftStatus, orderId: draftOrderId.trim(), organizationId: draftOrganizationId.trim() });
  }
  function resetFilters() {
    setDraftStatus(""); setDraftOrderId(""); setDraftOrganizationId(""); setPage(1); setFilters({ status: "", orderId: "", organizationId: "" });
  }
  async function transition() {
    if (!selected) return;
    const action = allowedAction[selected.status];
    if (!action) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const payload = await adminPostAction("/api/v1/admin/card-hour-topup-appeals", { appealId: selected.id, action, expectedVersion: selected.version, resolutionNote: action === "RESOLVE" ? resolutionNote.trim() : undefined });
      const updated = payload.record as CardHourTopupAppealRecord;
      setRecords((current) => current.map((item) => item.id === updated.id ? updated : item)); setSelected(updated); setResolutionNote(""); setNotice(`案件已更新为“${statusLabels[updated.status]}”。`);
    } catch (reason) { setError(reason); } finally { setBusy(false); }
  }
  return <section className="admin-appeals" aria-labelledby="admin-topup-appeals-title">
    <header className="admin-manual-delivery-head"><div><p className="admin-kicker">Payment appeals</p><h1 id="admin-topup-appeals-title">充值异常申诉</h1><span>按付款单人工核对；本页不提供修改支付状态、手工入账或自动退款能力。</span></div><button className="admin-button secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? "读取中…" : "刷新案件"}</button></header>
    <form className="admin-filterbar admin-topup-appeal-filters" onSubmit={applyFilters}>
      <label className="admin-select-filter"><span>案件状态</span><select onChange={(event) => setDraftStatus(event.target.value)} value={draftStatus}><option value="">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="admin-search"><span>付款单</span><input maxLength={96} onChange={(event) => setDraftOrderId(event.target.value)} placeholder="KAI_CH_…" type="search" value={draftOrderId} /></label>
      <label className="admin-search"><span>组织</span><input maxLength={128} onChange={(event) => setDraftOrganizationId(event.target.value)} placeholder="组织 ID" type="search" value={draftOrganizationId} /></label>
      <label className="admin-select-filter"><span>每页数量</span><select onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }} value={pageSize}><option value="10">10 条</option><option value="20">20 条</option><option value="50">50 条</option></select></label>
      <div className="admin-filter-actions"><button className="admin-button primary" disabled={loading} type="submit">应用筛选</button><button className="admin-button secondary" disabled={loading} onClick={resetFilters} type="button">重置</button></div>
    </form>
    {loading && records.length === 0 ? <AdminLoading /> : null}{error ? <AdminError message={adminErrorMessage(error, "充值申诉暂时无法处理。 ")} onRetry={() => void load()} /> : null}
    {!loading && !error && records.length === 0 ? <AdminEmpty description="用户针对付款单发起充值异常申诉后，案件会出现在这里。" title="暂无充值申诉" /> : null}
    {records.length ? <><div className="admin-table-wrap"><table className="admin-table"><caption>充值异常申诉</caption><thead><tr><th>案件</th><th>付款单</th><th>组织</th><th>金额 / 卡时</th><th>付款单状态</th><th>案件状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td className="admin-mono">{record.caseNumber}</td><td className="admin-mono">{record.topupOrderId}</td><td className="admin-mono">{record.organizationId}</td><td>{money(record.amountCents)} / {formatCardHourDisplayMicros(record.cardHourMicros)}</td><td>{record.topupStatus}</td><td><span className={`admin-status ${record.status === "CLOSED" ? "success" : "warning"}`}>{statusLabels[record.status]}</span></td><td>{dateTime(record.updatedAt)}</td><td><button className="admin-button secondary" onClick={() => { setSelected(record); setResolutionNote(""); setNotice(""); }} type="button">查看与处理</button></td></tr>)}</tbody></table></div><nav aria-label="充值申诉分页" className="admin-pagination"><span>第 {page} / {totalPages} 页 · 共 {total} 条</span><div><button className="admin-button secondary" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">上一页</button><button className="admin-button secondary" disabled={loading || page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} type="button">下一页</button></div></nav></> : null}
    {selected ? <section className="admin-action-panel admin-appeal-detail"><div><p className="admin-kicker">{selected.caseNumber}</p><h2>{selected.topupOrderId}</h2><span>{statusLabels[selected.status]} · 版本 {selected.version}</span><p>{selected.description}</p><dl className="admin-manual-timeline"><div><dt>组织 / 账号</dt><dd>{selected.organizationId}<br />{selected.accountId}</dd></div><div><dt>充值</dt><dd>{formatCardHourDisplayMicros(selected.cardHourMicros)} 卡时 · {money(selected.amountCents)}</dd></div><div><dt>当前付款单状态</dt><dd>{selected.topupStatus}</dd></div><div><dt>创建 / 更新</dt><dd>{dateTime(selected.createdAt)}<br />{dateTime(selected.updatedAt)}</dd></div></dl>{selected.resolutionNote ? <p><small>人工核对结论</small><br />{selected.resolutionNote}</p> : null}</div><div className="admin-action-fields">{allowedAction[selected.status] === "RESOLVE" ? <label><span>人工核对结论</span><textarea maxLength={2000} onChange={(event) => setResolutionNote(event.target.value)} value={resolutionNote} /></label> : null}{allowedAction[selected.status] ? <button className="admin-button primary" disabled={busy || (allowedAction[selected.status] === "RESOLVE" && resolutionNote.trim().length < 10)} onClick={() => void transition()} type="button">{busy ? "处理中…" : actionLabels[allowedAction[selected.status]!]}</button> : <p>案件已经关闭，没有可执行动作。</p>}<p className="admin-inline-warning">任何案件动作都不会修改付款单、卡时余额或退款状态；资金处理必须走独立人工流程。</p>{notice ? <div className="admin-inline-success" role="status"><strong>操作完成</strong><span>{notice}</span></div> : null}</div></section> : null}
  </section>;
}
