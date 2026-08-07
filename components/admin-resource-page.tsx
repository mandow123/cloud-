"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminApiError,
  adminErrorMessage,
  adminGetRows,
  adminPostAction,
  type AdminRow,
} from "@/components/admin-api-client";
import { AdminPageHeader } from "@/components/admin-page-header";
import { AdminEmpty, AdminError, AdminLoading, AdminLoginRequired } from "@/components/admin-states";
import { adminSectionConfigs, type AdminField, type AdminSectionKey } from "@/lib/admin-view-models";

function nestedValue(row: AdminRow, path: string): unknown {
  let current: unknown = row;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function fieldValue(row: AdminRow, field: AdminField) {
  for (const path of field.paths) {
    const value = nestedValue(row, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function textValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => textValue(item)).filter(Boolean).join("、");
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["label", "name", "status", "id"]) if (typeof object[key] === "string") return object[key] as string;
  }
  return "—";
}

function displayValue(value: unknown, field: AdminField) {
  if (value === undefined || value === null || value === "") return "—";
  if (field.format === "money" && typeof value === "number") {
    return `¥${(value / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (field.format === "number" && typeof value === "number") return value.toLocaleString("zh-CN");
  if (field.format === "duration" && typeof value === "number") return `${value.toLocaleString("zh-CN")} 小时`;
  if (field.format === "datetime" && typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString("zh-CN");
  }
  return textValue(value);
}

function statusTone(value: string) {
  const normalized = value.toUpperCase();
  if (["PASSED", "VERIFIED", "PUBLISHED", "PAID", "DELIVERED", "COMPLETED", "RESOLVED", "ACTIVE", "READY", "SUCCESS"].includes(normalized)) return "success";
  if (["FAILED", "REJECTED", "CANCELLED", "SUSPENDED", "BLOCKED", "CRITICAL", "P0"].includes(normalized)) return "danger";
  if (["PENDING", "SUBMITTED", "PROCESSING", "PROVISIONING", "UNDER_VERIFICATION", "P1", "HIGH"].includes(normalized)) return "warning";
  return "neutral";
}

function rowId(row: AdminRow, index: number) {
  for (const key of ["id", "orderId", "offerId", "demandId", "matchId", "poolId", "jobId", "accountId", "actorId", "requestId"]) {
    if (typeof row[key] === "string" && row[key]) return row[key] as string;
  }
  return `unselectable-${index}`;
}

function searchable(row: AdminRow) {
  return JSON.stringify(row).toLocaleLowerCase("zh-CN");
}

function AdminSafeAction({ section, selectedRows, onCommitted }: { section: AdminSectionKey; selectedRows: AdminRow[]; onCommitted: () => void }) {
  const config = adminSectionConfigs[section];
  const [action, setAction] = useState(config.actions[0]?.value ?? "");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [adminRoles, setAdminRoles] = useState("SUPPORT_READONLY");
  const selectedAction = config.actions.find((item) => item.value === action);
  const actionEndpoint = config.actionEndpoint;
  const selectedIds = selectedRows.map((row, index) => rowId(row, index));

  if (!actionEndpoint || config.actions.length === 0) return null;

  async function submit() {
    setError("");
    setNotice("");
    if (!actionEndpoint) return;
    const isAdminInvite = section === "admins" && action === "INVITE_ADMIN";
    if (!isAdminInvite && selectedIds.length === 0) {
      setError("请先选择至少一条服务端记录。");
      return;
    }
    if (selectedIds.length > 50) {
      setError("单次最多处理 50 条记录，请缩小选择范围。");
      return;
    }
    if (reason.trim().length < 8) {
      setError("操作理由至少填写 8 个字符，便于审计追踪。");
      return;
    }
    if (selectedAction?.highRisk && !confirmed) {
      setError("该动作风险较高，请确认影响范围后再提交。");
      return;
    }
    setBusy(true);
    try {
      let results: Record<string, unknown>[];
      if (section === "work-items") {
        const status = action === "RESOLVE" ? "RESOLVED" : "WAITING";
        results = await Promise.all(selectedRows.map((row, index) => {
          const expectedVersion = Number(row.version);
          if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error(`记录 ${selectedIds[index]} 缺少有效版本号。`);
          return adminPostAction(`${actionEndpoint}/${encodeURIComponent(selectedIds[index])}`, { expectedVersion, status, reason: reason.trim() }, "PATCH");
        }));
      } else if (section === "supply-offers" || section === "demands") {
        results = await Promise.all(selectedIds.map((entityId) => adminPostAction(actionEndpoint, {
          entityId,
          action,
          reason: reason.trim(),
          priority: selectedAction?.highRisk ? "HIGH" : "NORMAL",
        })));
      } else if (section === "matches") {
        results = await Promise.all(selectedIds.map((matchId) => adminPostAction(actionEndpoint, {
          matchId,
          title: `Review match ${matchId}`,
          reason: reason.trim(),
          priority: selectedAction?.highRisk ? "HIGH" : "NORMAL",
        })));
      } else if (section === "payments") {
        if (selectedRows.length !== 1) throw new Error("退款操作一次只能选择一条记录。");
        const row = selectedRows[0];
        const sourceLabel = row._sourceLabel;
        const expectedVersion = Number(row.version ?? nestedValue(row, "facts.version"));
        if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error("记录缺少有效版本号，不能安全提交退款操作。");
        if (action === "REQUEST_REFUND") {
          if (sourceLabel !== "支付") throw new Error("申请退款必须选择支付记录，而不是退款案件。");
          const amountCents = Math.round(Number(refundAmount) * 100);
          const maximum = Number(row.amountCents);
          if (!Number.isSafeInteger(amountCents) || amountCents < 1 || !Number.isFinite(maximum) || amountCents > maximum) throw new Error("退款金额必须大于 0，且不能超过原支付金额。");
          results = [await adminPostAction(actionEndpoint, {
            sourceSystem: row.sourceSystem,
            entityType: row.entityType,
            entityId: row.id,
            amountCents,
            expectedVersion,
            reason: reason.trim(),
          })];
        } else {
          if (sourceLabel !== "退款") throw new Error("批准或拒绝必须选择退款案件。");
          results = [await adminPostAction(`${actionEndpoint}/${encodeURIComponent(String(row.id))}/decision`, {
            expectedVersion,
            decision: action === "APPROVE_REFUND" ? "APPROVED" : "REJECTED",
            reason: reason.trim(),
          })];
        }
      } else if (section === "admins") {
        const roles = [...new Set(adminRoles.split(/[，,\s]+/).map((role) => role.trim()).filter(Boolean))];
        if (roles.length === 0) throw new Error("请至少填写一个管理员角色代码。");
        if (isAdminInvite) {
          if (!inviteEmail.trim() || !inviteName.trim()) throw new Error("邀请管理员时必须填写姓名和邮箱。");
          results = [await adminPostAction(actionEndpoint, {
            email: inviteEmail.trim(),
            displayName: inviteName.trim(),
            roles,
            expectedVersion: 0,
            reason: reason.trim(),
          })];
        } else {
          if (selectedRows.length !== 1) throw new Error("管理员权限操作一次只能选择一个管理员账号。");
          const row = selectedRows[0];
          if (row._sourceLabel === "角色目录") throw new Error("角色目录只读；请选中管理员账号。");
          const expectedVersion = Number(row.version);
          if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error("管理员账号缺少有效版本号。");
          const accountId = selectedIds[0];
          if (action === "SET_ROLES") {
            results = [await adminPostAction(`${actionEndpoint}/${encodeURIComponent(accountId)}/roles`, { roles, expectedVersion, reason: reason.trim() }, "PUT")];
          } else {
            results = [await adminPostAction(`${actionEndpoint}/${encodeURIComponent(accountId)}/status`, {
              status: action === "ACTIVATE_ADMIN" ? "ACTIVE" : "SUSPENDED",
              expectedVersion,
              reason: reason.trim(),
            }, "PATCH")];
          }
        }
      } else {
        throw new Error("该模块尚无已批准的写入接口。");
      }
      const serverMessage = results.find((result) => typeof result.message === "string")?.message;
      setNotice(typeof serverMessage === "string" ? serverMessage : `服务端已受理 ${results.length} 项操作请求，请刷新列表核对最终状态。`);
      onCommitted();
    } catch (submitError) {
      setError(submitError instanceof AdminApiError
        ? adminErrorMessage(submitError, "管理员操作未完成。")
        : submitError instanceof Error ? submitError.message : "管理员操作未完成。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-action-panel" aria-labelledby={`${section}-actions-title`}>
      <div>
        <p className="admin-kicker">Audited action</p>
        <h2 id={`${section}-actions-title`}>批量安全操作</h2>
        <span>已选择 {selectedIds.length} 条。这里只提交操作请求，页面不会在服务端确认前改写业务状态。</span>
      </div>
      <div className="admin-action-fields">
        <label><span>动作</span><select onChange={(event) => { setAction(event.target.value); setConfirmed(false); }} value={action}>{config.actions.map((item) => <option key={item.value} value={item.value}>{item.label}{item.highRisk ? "（高风险）" : ""}</option>)}</select></label>
        {section === "payments" && action === "REQUEST_REFUND" ? <label><span>退款金额（元）</span><input min="0.01" onChange={(event) => setRefundAmount(event.target.value)} step="0.01" type="number" value={refundAmount} /></label> : null}
        {section === "admins" && action === "INVITE_ADMIN" ? <><label><span>管理员姓名</span><input onChange={(event) => setInviteName(event.target.value)} placeholder="用于后台显示" type="text" value={inviteName} /></label><label><span>管理员邮箱</span><input onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@kai.com" type="email" value={inviteEmail} /></label></> : null}
        {section === "admins" && ["INVITE_ADMIN", "SET_ROLES"].includes(action) ? <label><span>角色代码</span><input onChange={(event) => setAdminRoles(event.target.value)} placeholder="多个角色用逗号分隔" type="text" value={adminRoles} /></label> : null}
        <label className="admin-reason"><span>操作理由</span><textarea maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="说明依据、影响范围和预期结果" rows={3} value={reason} /></label>
        {selectedAction?.highRisk ? <label className="admin-confirm"><input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" /><span>我已核对影响范围，确认提交高风险操作请求。</span></label> : null}
        <button className={`admin-button ${selectedAction?.highRisk ? "danger" : "primary"}`} disabled={busy} onClick={() => void submit()} type="button">{busy ? "正在提交…" : "提交操作请求"}</button>
      </div>
      {error ? <div className="admin-inline-error" role="alert"><strong>操作未提交</strong><span>{error}</span></div> : null}
      {notice ? <div className="admin-inline-success" role="status"><strong>服务端响应</strong><span>{notice}</span></div> : null}
    </section>
  );
}

export function AdminResourcePage({ section }: { section: AdminSectionKey }) {
  const config = adminSectionConfigs[section];
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const fetchRows = useCallback(async () => (await Promise.all(config.endpoints.map((endpoint) => adminGetRows(endpoint)))).flat(), [config]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchRows());
      setSelected([]);
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, [fetchRows]);

  useEffect(() => {
    let cancelled = false;
    void fetchRows()
      .then((items) => { if (!cancelled) setRows(items); })
      .catch((loadError: unknown) => { if (!cancelled) setError(loadError); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchRows]);

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return rows.filter((row) => (!normalized || searchable(row).includes(normalized))
      && (!statusFilter || row.status === statusFilter)
      && (!sourceFilter || row.sourceSystem === sourceFilter));
  }, [query, rows, sourceFilter, statusFilter]);
  const statuses = [...new Set(rows.map((row) => typeof row.status === "string" ? row.status : "").filter(Boolean))].sort();
  const sources = [...new Set(rows.map((row) => typeof row.sourceSystem === "string" ? row.sourceSystem : "").filter(Boolean))].sort();
  const selectableIds = visibleRows.map(rowId).filter((id) => !id.startsWith("unselectable-"));
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.includes(id));

  if (error instanceof AdminApiError && [401, 403].includes(error.status)) return <AdminLoginRequired forbidden={error.status === 403} />;

  return (
    <div className="admin-page">
      <AdminPageHeader
        actions={<button className="admin-button secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? "读取中…" : "刷新服务端数据"}</button>}
        description={config.description}
        kicker={config.kicker}
        title={config.title}
      />

      <section className="admin-filterbar" aria-label="列表筛选">
        <label className="admin-search"><span>搜索当前结果</span><input onChange={(event) => setQuery(event.target.value)} placeholder="输入 ID、名称、供应商或状态" type="search" value={query} /></label>
        <label className="admin-select-filter"><span>状态</span><select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="">全部状态</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label className="admin-select-filter"><span>来源系统</span><select onChange={(event) => setSourceFilter(event.target.value)} value={sourceFilter}><option value="">全部来源</option>{sources.map((source) => <option key={source}>{source}</option>)}</select></label>
        <div className="admin-filter-hints" aria-label="建议筛选维度"><span>维度：</span>{config.filters.map((filter) => <small key={filter}>{filter}</small>)}</div>
        <span className="admin-result-count">{visibleRows.length} / {rows.length} 条</span>
      </section>

      {loading && rows.length === 0 ? <AdminLoading /> : null}
      {error ? <AdminError message={adminErrorMessage(error, "暂时无法读取管理员列表。") } onRetry={() => void load()} /> : null}
      {!loading && !error && rows.length === 0 ? <AdminEmpty description={config.emptyDescription} title={config.emptyTitle} /> : null}

      {rows.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption>{config.title}服务端记录</caption>
            <thead><tr>{config.actions.length > 0 ? <th className="admin-check"><input aria-label="选择当前全部记录" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? selectableIds : [])} type="checkbox" /></th> : null}{config.fields.map((field) => <th key={field.label} style={field.width ? { minWidth: field.width } : undefined}>{field.label}</th>)}</tr></thead>
            <tbody>{visibleRows.map((row, index) => {
              const id = rowId(row, index);
              const canSelect = !id.startsWith("unselectable-");
              return (
                <tr key={id}>
                  {config.actions.length > 0 ? <td className="admin-check"><input aria-label={`选择 ${id}`} checked={selected.includes(id)} disabled={!canSelect} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, id])] : current.filter((item) => item !== id))} type="checkbox" /></td> : null}
                  {config.fields.map((field) => {
                    const value = displayValue(fieldValue(row, field), field);
                    return <td className={field.format === "id" ? "admin-mono" : field.format === "number" || field.format === "money" ? "admin-number" : ""} key={field.label}>{field.format === "status" && value !== "—" ? <span className={`admin-status ${statusTone(value)}`}>{value}</span> : value}</td>;
                  })}
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ) : null}

      <AdminSafeAction onCommitted={() => void load()} section={section} selectedRows={rows.filter((row, index) => selected.includes(rowId(row, index)))} />
    </div>
  );
}
