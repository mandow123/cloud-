"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { adminErrorMessage, adminGetRows, adminPostAction, type AdminRow } from "./admin-api-client";
import { AdminPageHeader } from "./admin-page-header";

type ActivityAction = "PUBLISH" | "REJECT" | "GRANT_REWARD" | "REVOKE_REWARD";

const ACTION_LABELS: Record<ActivityAction, string> = {
  PUBLISH: "审核通过并公开",
  REJECT: "拒绝公开",
  GRANT_REWARD: "发放 KAI 奖励",
  REVOKE_REWARD: "撤销最近一笔奖励",
};

function value(row: AdminRow, key: string) {
  return typeof row[key] === "string" || typeof row[key] === "number" ? String(row[key]) : "—";
}

function statusLabel(status: string) {
  if (status === "PENDING") return "待审核";
  if (status === "PUBLISHED") return "已公开";
  if (status === "REJECTED") return "未通过";
  return status || "未知";
}

function statusTone(status: string) {
  if (status === "PUBLISHED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "REJECTED") return "danger";
  return "";
}

function dateTime(raw: string) {
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? "—" : value.toLocaleString("zh-CN");
}

export function ActivityAdmin() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AdminRow | null>(null);
  const [action, setAction] = useState<ActivityAction>("PUBLISH");
  const [reason, setReason] = useState("");
  const [units, setUnits] = useState("100");
  const [confirmed, setConfirmed] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const items = await adminGetRows({ path: "/api/v1/admin/activity" });
      setRows(items);
      setSelected((current) => current ? items.find((item) => item.id === current.id) ?? null : null);
    } catch (cause) {
      setError(adminErrorMessage(cause, "无法读取作品，请检查网络后重试。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return rows.filter((row) => {
      if (status !== "ALL" && value(row, "status") !== status) return false;
      if (!normalized) return true;
      return ["title", "author_name", "campaign_title", "id"].some((key) => value(row, key).toLocaleLowerCase("zh-CN").includes(normalized));
    });
  }, [query, rows, status]);

  const destructive = action === "REJECT" || action === "REVOKE_REWARD";
  const numericUnits = Number(units);
  const unitsValid = action !== "GRANT_REWARD" || Number.isSafeInteger(numericUnits) && numericUnits >= 1 && numericUnits <= 1_000_000;
  const canSubmit = Boolean(selected) && reason.trim().length >= 8 && unitsValid && (!destructive || confirmed) && !busy;

  function choose(row: AdminRow) {
    setSelected(row);
    setReason("");
    setConfirmed(false);
    setNotice("");
  }

  function changeAction(next: ActivityAction) {
    setAction(next);
    setConfirmed(false);
    setNotice("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canSubmit) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await adminPostAction("/api/v1/admin/activity", {
        submissionId: selected.id,
        action,
        reason: reason.trim(),
        ...(action === "GRANT_REWARD" ? { units: numericUnits } : {}),
      });
      setNotice(`《${value(selected, "title")}》已完成“${ACTION_LABELS[action]}”，操作已记录审计事件。`);
      setReason("");
      setConfirmed(false);
      await load(false);
    } catch (cause) {
      setError(adminErrorMessage(cause, "操作失败，请稍后重试。"));
    } finally {
      setBusy(false);
    }
  }

  return <div className="admin-page">
    <AdminPageHeader
      title="活动与作品管理"
      kicker="Content operations"
      description="审核用户投稿、控制公开状态并发放或撤销 KAI 奖励。每次操作必须填写理由并写入审计记录。"
      actions={<button className="admin-button secondary" disabled={loading || busy} onClick={() => void load()} type="button">{loading ? "正在刷新…" : "刷新队列"}</button>}
    />

    {error ? <div className="admin-inline-error" role="alert"><strong>操作未完成</strong><span>{error}</span></div> : null}
    {notice ? <div className="admin-inline-success" role="status" aria-live="polite"><strong>操作成功</strong><span>{notice}</span></div> : null}

    <div className="activity-admin-filters" aria-label="筛选投稿">
      <label className="admin-search"><span>搜索投稿</span><input onChange={(event) => setQuery(event.target.value)} placeholder="作品、作者、活动或投稿编号" type="search" value={query} /></label>
      <label className="admin-select-filter"><span>审核状态</span><select onChange={(event) => setStatus(event.target.value)} value={status}><option value="ALL">全部状态</option><option value="PENDING">待审核</option><option value="PUBLISHED">已公开</option><option value="REJECTED">未通过</option></select></label>
      <span className="admin-result-count" role="status">显示 {filteredRows.length} / {rows.length} 条</span>
    </div>

    {loading && rows.length === 0 ? <div className="admin-state" role="status"><strong>正在读取服务端作品</strong><span>请稍候，审核队列即将显示。</span></div> : null}
    {!loading && rows.length === 0 ? <div className="admin-empty"><h2>暂无投稿</h2><p>用户提交作品后会先进入待审核队列。</p></div> : null}
    {!loading && rows.length > 0 && filteredRows.length === 0 ? <div className="admin-empty"><h2>没有符合条件的投稿</h2><p>请调整搜索内容或审核状态。</p></div> : null}

    {rows.length ? <div className="activity-admin-grid" aria-busy={loading || busy}>
      <div className="admin-table-wrap">
        <table className="admin-table activity-admin-table">
          <caption>投稿审核队列，共 {filteredRows.length} 条</caption>
          <thead><tr><th scope="col">选择</th><th scope="col">作品</th><th scope="col">作者</th><th scope="col">活动</th><th scope="col">票数</th><th scope="col">奖励</th><th scope="col">状态</th><th scope="col">提交时间</th></tr></thead>
          <tbody>{filteredRows.map((row) => {
            const rowStatus = value(row, "status");
            const isSelected = selected?.id === row.id;
            return <tr aria-selected={isSelected} className={isSelected ? "activity-admin-selected" : ""} key={value(row, "id")}>
              <td className="admin-check"><input aria-label={`选择 ${value(row, "title")}`} checked={isSelected} name="activity-submission" onChange={() => choose(row)} type="radio" value={value(row, "id")} /></td>
              <th scope="row"><a href={`/api/activity/assets/${encodeURIComponent(value(row, "id"))}`} rel="noreferrer" target="_blank">{value(row, "title")} ↗<span className="sr-only">（在新窗口打开作品图片）</span></a></th>
              <td>{value(row, "author_name")}</td><td>{value(row, "campaign_title")}</td><td className="admin-number">{value(row, "vote_count")}</td><td className="admin-number">{value(row, "reward_units")}</td>
              <td><span className={`admin-status ${statusTone(rowStatus)}`}>{statusLabel(rowStatus)}</span></td><td>{dateTime(value(row, "created_at"))}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>

      <section className="admin-action-panel activity-admin-panel" aria-labelledby="activity-action-title">
        <div>
          <p className="admin-kicker">Audited action</p><h2 id="activity-action-title">审核与奖励</h2>
          <span>{selected ? `已选择：《${value(selected, "title")}》` : "请先在审核队列中选择一条投稿。"}</span>
          {selected ? <div className="activity-admin-preview">{/* eslint-disable-next-line @next/next/no-img-element */}<img alt={`待审核作品《${value(selected, "title")}》预览`} src={`/api/activity/assets/${encodeURIComponent(value(selected, "id"))}`} /><dl><div><dt>当前状态</dt><dd>{statusLabel(value(selected, "status"))}</dd></div><div><dt>作者</dt><dd>{value(selected, "author_name")}</dd></div><div><dt>现有奖励</dt><dd>{value(selected, "reward_units")} KAI 时</dd></div></dl></div> : null}
        </div>
        <form className="admin-action-fields" onSubmit={submit}>
          <label><span>动作</span><select disabled={busy} onChange={(event) => changeAction(event.target.value as ActivityAction)} value={action}><option value="PUBLISH">审核通过并公开</option><option value="REJECT">拒绝公开</option><option value="GRANT_REWARD">发放 KAI 奖励</option><option value="REVOKE_REWARD">撤销最近一笔奖励</option></select></label>
          {action === "GRANT_REWARD" ? <label><span>奖励数量</span><input aria-describedby="activity-units-help" disabled={busy} max="1000000" min="1" onChange={(event) => setUnits(event.target.value)} required step="1" type="number" value={units} /><small id="activity-units-help">1–1,000,000 KAI 时，必须为整数</small></label> : null}
          <label className="admin-reason"><span>操作理由（至少 8 字）</span><textarea aria-describedby="activity-reason-help" disabled={busy} maxLength={500} minLength={8} onChange={(event) => setReason(event.target.value)} required rows={4} value={reason} /><small id="activity-reason-help">{reason.trim().length}/500 字；理由会进入审计记录</small></label>
          {destructive ? <label className="admin-confirm"><input checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" /><span>我已核对作品与账户，确认执行“{ACTION_LABELS[action]}”。</span></label> : null}
          {!unitsValid ? <div className="admin-inline-error" role="alert">奖励数量必须是 1–1,000,000 之间的整数。</div> : null}
          <button className={`admin-button ${destructive ? "danger" : "primary"}`} disabled={!canSubmit} type="submit">{busy ? "正在提交，请勿重复操作…" : selected ? `确认${ACTION_LABELS[action]}` : "请先选择投稿"}</button>
        </form>
      </section>
    </div> : null}
  </div>;
}
