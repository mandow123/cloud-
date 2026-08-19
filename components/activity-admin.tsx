"use client";

import { useCallback, useEffect, useState } from "react";
import { adminGetRows, adminPostAction, type AdminRow } from "./admin-api-client";
import { AdminPageHeader } from "./admin-page-header";

function value(row: AdminRow, key: string) { return typeof row[key] === "string" || typeof row[key] === "number" ? String(row[key]) : "—"; }

export function ActivityAdmin() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AdminRow | null>(null);
  const [action, setAction] = useState("PUBLISH");
  const [reason, setReason] = useState("");
  const [units, setUnits] = useState("100");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(""); try { setRows(await adminGetRows({ path: "/api/v1/admin/activity" })); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取作品。 "); } finally { setLoading(false); } }, []);
  useEffect(() => {
    let cancelled = false;
    void adminGetRows({ path: "/api/v1/admin/activity" })
      .then((items) => { if (!cancelled) setRows(items); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "无法读取作品。 "); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function submit() {
    if (!selected) return;
    setError(""); setNotice(""); setBusy(true);
    try {
      await adminPostAction("/api/v1/admin/activity", { submissionId: selected.id, action, reason, ...(action === "GRANT_REWARD" ? { units: Number(units) } : {}) });
      setNotice("操作已写入服务端并记录审计事件。 "); setReason(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。 "); }
    finally { setBusy(false); }
  }

  return <div className="admin-page">
    <AdminPageHeader title="活动与作品管理" kicker="Content operations" description="审核用户投稿、控制公开状态并发放或撤销 KAI 奖励。每次操作必须填写理由并写入审计记录。" actions={<button className="admin-button secondary" onClick={() => void load()} type="button">刷新</button>} />
    {error ? <div className="admin-inline-error" role="alert">{error}</div> : null}
    {notice ? <div className="admin-inline-success" role="status">{notice}</div> : null}
    {loading ? <p>正在读取服务端作品…</p> : null}
    {!loading && rows.length === 0 ? <div className="admin-empty"><h2>暂无投稿</h2><p>用户提交作品后会先进入待审核队列。</p></div> : null}
    {rows.length ? <div className="activity-admin-grid">
      <div className="admin-table-wrap"><table className="admin-table"><caption>投稿审核队列</caption><thead><tr><th>选择</th><th>作品</th><th>作者</th><th>活动</th><th>票数</th><th>奖励</th><th>状态</th><th>提交时间</th></tr></thead><tbody>{rows.map((row) => <tr key={value(row, "id")}><td><input aria-label={`选择 ${value(row, "title")}`} checked={selected?.id === row.id} onChange={() => setSelected(row)} type="radio" /></td><td><a href={`/api/activity/assets/${encodeURIComponent(value(row, "id"))}`} rel="noreferrer" target="_blank">{value(row, "title")} ↗</a></td><td>{value(row, "author_name")}</td><td>{value(row, "campaign_title")}</td><td>{value(row, "vote_count")}</td><td>{value(row, "reward_units")}</td><td><span className="admin-status">{value(row, "status")}</span></td><td>{new Date(value(row, "created_at")).toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div>
      <section className="admin-action-panel"><div><p className="admin-kicker">Audited action</p><h2>审核与奖励</h2><span>{selected ? `已选择：${value(selected, "title")}` : "请先选择一条投稿。"}</span></div><div className="admin-action-fields"><label><span>动作</span><select onChange={(event) => setAction(event.target.value)} value={action}><option value="PUBLISH">审核通过并公开</option><option value="REJECT">拒绝公开</option><option value="GRANT_REWARD">发放 KAI 奖励</option><option value="REVOKE_REWARD">撤销最近一笔奖励</option></select></label>{action === "GRANT_REWARD" ? <label><span>奖励数量</span><input max="1000000" min="1" onChange={(event) => setUnits(event.target.value)} type="number" value={units} /></label> : null}<label className="admin-reason"><span>操作理由（至少 8 字）</span><textarea maxLength={500} onChange={(event) => setReason(event.target.value)} rows={4} value={reason} /></label><button className="admin-button primary" disabled={busy || !selected || reason.trim().length < 8} onClick={() => void submit()} type="button">{busy ? "正在提交…" : "确认提交"}</button></div></section>
    </div> : null}
  </div>;
}
