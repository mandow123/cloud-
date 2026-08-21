"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminApiError, adminErrorMessage, adminGetJson, adminGetRows, adminPostAction } from "@/components/admin-api-client";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin-states";
import type { AdminManualDeliveryIntake, AdminManualDeliveryPublicKey, ManualDeliveryStatus, ManualDeliverySupplierCandidate } from "@/lib/server/admin-store";

const STATUS_LABELS: Record<ManualDeliveryStatus, string> = {
  PENDING_MANUAL_DELIVERY: "待分配供应商", SUPPLIER_ASSIGNED: "已分配供应商", DELIVERY_IN_PROGRESS: "配置中",
  AWAITING_BUYER_ACCEPTANCE: "等待买家确认", COMPLETED: "买家已确认", CANCELLED: "已取消", ACCESS_REVOKED: "访问已撤销",
};
type AdminAction = "assign" | "start" | "mark-delivered" | "cancel" | "revoke";

function dateTime(value: string | null | undefined) { if (!value) return "—"; const timestamp = Date.parse(value); return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString("zh-CN"); }
function actionAllowed(status: ManualDeliveryStatus, action: AdminAction) {
  if (action === "assign") return status === "PENDING_MANUAL_DELIVERY" || status === "SUPPLIER_ASSIGNED";
  if (action === "start") return status === "SUPPLIER_ASSIGNED";
  if (action === "mark-delivered") return status === "DELIVERY_IN_PROGRESS";
  if (action === "cancel") return ["PENDING_MANUAL_DELIVERY", "SUPPLIER_ASSIGNED", "DELIVERY_IN_PROGRESS"].includes(status);
  return ["AWAITING_BUYER_ACCEPTANCE", "COMPLETED"].includes(status);
}
function recordFromPayload(payload: Record<string, unknown>) { const record = payload.record; if (!record || typeof record !== "object" || Array.isArray(record)) throw new AdminApiError("人工交付响应格式无效。", 200, "INVALID_RESPONSE"); return record as AdminManualDeliveryIntake; }

export function AdminManualDeliveryIntakes() {
  const [rows, setRows] = useState<AdminManualDeliveryIntake[]>([]);
  const [selected, setSelected] = useState<AdminManualDeliveryIntake | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<AdminAction | "reveal" | null>(null);
  const [revealed, setRevealed] = useState<AdminManualDeliveryPublicKey | null>(null);
  const [supplierCandidates, setSupplierCandidates] = useState<ManualDeliverySupplierCandidate[]>([]);
  const [supplierOrganizationId, setSupplierOrganizationId] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [buyerVisibleNote, setBuyerVisibleNote] = useState("");
  const [reason, setReason] = useState("");
  const [host, setHost] = useState(""); const [port, setPort] = useState("22"); const [username, setUsername] = useState("root"); const [hostKeyFingerprint, setHostKeyFingerprint] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [records, candidatePayload] = await Promise.all([adminGetRows({ path: "/api/v1/admin/manual-deliveries" }) as unknown as Promise<AdminManualDeliveryIntake[]>, adminGetJson("/api/v1/admin/manual-deliveries/supplier-candidates")]);
      const candidates = Array.isArray(candidatePayload.records) ? candidatePayload.records.filter((item): item is ManualDeliverySupplierCandidate => Boolean(item) && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).organizationId === "string" && typeof (item as Record<string, unknown>).organizationName === "string") : [];
      setRows(records); setSupplierCandidates(candidates); setSelected((current) => current ? records.find((record) => record.demandId === current.demandId) ?? null : null);
    }
    catch (loadError) { setError(loadError); } finally { setLoading(false); }
  }, []);
  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load(); }); return () => window.cancelAnimationFrame(frame); }, [load]);

  async function selectDelivery(demandId: string) {
    setError(null); setNotice(""); setRevealed(null);
    try {
      const record = recordFromPayload(await adminGetJson(`/api/v1/admin/manual-deliveries/${encodeURIComponent(demandId)}`));
      setSelected(record); setSupplierOrganizationId(record.supplierOrganizationId ?? ""); setInternalNote(record.internalNote ?? ""); setBuyerVisibleNote(record.buyerVisibleNote ?? "");
      setHost(record.connection?.host ?? ""); setPort(String(record.connection?.port ?? 22)); setUsername(record.connection?.username ?? "root"); setHostKeyFingerprint(record.connection?.hostKeyFingerprint ?? ""); setReason("");
    } catch (selectError) { setError(selectError); }
  }
  async function reveal() {
    if (!selected) return; setBusy("reveal"); setError(null);
    try { setRevealed(recordFromPayload(await adminGetJson(`/api/v1/admin/manual-deliveries/${encodeURIComponent(selected.demandId)}/ssh-public-key`)) as unknown as AdminManualDeliveryPublicKey); }
    catch (revealError) { setError(revealError); } finally { setBusy(null); }
  }
  async function copyKey() { if (!revealed) return; await navigator.clipboard.writeText(revealed.canonicalSshPublicKey); setNotice("买家公钥已复制；只可交给本单指定供应商。 "); }
  async function transition(action: AdminAction) {
    if (!selected) return; setBusy(action); setError(null); setNotice("");
    const payload = action === "assign" ? { expectedVersion: selected.statusVersion, supplierOrganizationId: supplierOrganizationId.trim(), note: internalNote.trim() || undefined }
      : action === "start" ? { expectedVersion: selected.statusVersion, note: internalNote.trim() || undefined }
        : action === "mark-delivered" ? { expectedVersion: selected.statusVersion, connection: { host: host.trim(), port: Number(port), username: username.trim(), hostKeyFingerprint: hostKeyFingerprint.trim() || undefined }, buyerVisibleNote: buyerVisibleNote.trim() || undefined, note: internalNote.trim() || undefined }
          : { expectedVersion: selected.statusVersion, reason: reason.trim() };
    try { const updated = recordFromPayload(await adminPostAction(`/api/v1/admin/manual-deliveries/${encodeURIComponent(selected.demandId)}/${action}`, payload)); setSelected(updated); setRows((current) => current.map((record) => record.demandId === updated.demandId ? updated : record)); setNotice(`申请已更新为“${STATUS_LABELS[updated.status]}”。`); setReason(""); }
    catch (actionError) { setError(actionError); } finally { setBusy(null); }
  }

  return <section className="admin-manual-delivery" aria-labelledby="manual-delivery-title">
    <div className="admin-manual-delivery-head"><div><p className="admin-kicker">Manual SSH delivery</p><h2 id="manual-delivery-title">人工 SSH 交付任务</h2><span>每次状态变化都使用版本校验并写入审计；公钥默认隐藏，连接信息仅在交付后对买家可见。</span></div><button className="admin-button secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? "读取中…" : "刷新任务"}</button></div>
    {loading && rows.length === 0 ? <AdminLoading /> : null}
    {error ? <AdminError message={adminErrorMessage(error, "人工交付操作暂时无法完成。 ")} onRetry={() => void load()} /> : null}
    {!loading && !error && rows.length === 0 ? <AdminEmpty description="买家提交需要 SSH 交付的目录询价后，申请会出现在这里。" title="暂无人工交付任务" /> : null}
    {rows.length ? <div className="admin-table-wrap"><table className="admin-table"><caption>人工交付任务及当前状态</caption><thead><tr><th>申请</th><th>买家主体</th><th>资源</th><th>供应商</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.demandId}><td className="admin-mono">{row.demandId}</td><td><strong>{row.organizationName ?? row.buyerDisplayName ?? "未命名主体"}</strong><br /><small>{row.buyerEmail ?? row.buyerAccountId}</small></td><td><strong>{row.resourceTitle}</strong><br /><small>{row.resourceId}</small></td><td>{row.supplierOrganizationName ?? row.supplierOrganizationId ?? "待分配"}</td><td><span className={`admin-status ${row.status === "COMPLETED" ? "success" : ["CANCELLED", "ACCESS_REVOKED"].includes(row.status) ? "danger" : "warning"}`}>{STATUS_LABELS[row.status]}</span></td><td>{dateTime(row.updatedAt)}</td><td><button className="admin-button secondary" onClick={() => void selectDelivery(row.demandId)} type="button">查看与处理</button></td></tr>)}</tbody></table></div> : null}
    {selected ? <section className="admin-action-panel" aria-labelledby="manual-delivery-action-title">
      <div><p className="admin-kicker">Delivery control</p><h2 id="manual-delivery-action-title">{selected.resourceTitle}</h2><span>{selected.demandId} · 当前 {STATUS_LABELS[selected.status]} · 版本 {selected.statusVersion}</span><dl className="admin-manual-timeline"><div><dt>已分配</dt><dd>{dateTime(selected.deliveryTimeline.assignedAt)}</dd></div><div><dt>开始配置</dt><dd>{dateTime(selected.deliveryTimeline.startedAt)}</dd></div><div><dt>已交付</dt><dd>{dateTime(selected.deliveryTimeline.deliveredAt)}</dd></div><div><dt>买家确认</dt><dd>{dateTime(selected.deliveryTimeline.completedAt)}</dd></div></dl>{selected.internalNote ? <p><small>内部备注</small><br />{selected.internalNote}</p> : null}{selected.buyerVisibleNote ? <p><small>买家可见说明</small><br />{selected.buyerVisibleNote}</p> : null}<p><small>买家公钥指纹</small><br /><code className="admin-mono">{selected.sshPublicKeyFingerprint}</code></p><button className="admin-button secondary" disabled={busy !== null} onClick={() => void reveal()} type="button">{busy === "reveal" ? "读取中…" : revealed ? "重新查看公钥" : "查看买家公钥"}</button>{revealed ? <div className="admin-manual-key"><code>{revealed.canonicalSshPublicKey}</code><button className="admin-button secondary" onClick={() => void copyKey()} type="button">复制公钥</button></div> : null}</div>
      <div className="admin-action-fields">
        {actionAllowed(selected.status, "assign") ? <><label><span>具备交付资格的供应商</span><select value={supplierOrganizationId} onChange={(event) => setSupplierOrganizationId(event.target.value)}><option value="">请选择供应商</option>{selected.supplierOrganizationId && !supplierCandidates.some((candidate) => candidate.organizationId === selected.supplierOrganizationId) ? <option value={selected.supplierOrganizationId}>{selected.supplierOrganizationName ?? "当前已分配供应商"}</option> : null}{supplierCandidates.map((candidate) => <option key={candidate.organizationId} value={candidate.organizationId}>{candidate.organizationName}</option>)}</select></label><label><span>内部备注</span><textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} /></label><button className="admin-button primary" disabled={busy !== null || !supplierOrganizationId.trim()} onClick={() => void transition("assign")} type="button">{busy === "assign" ? "分配中…" : selected.status === "SUPPLIER_ASSIGNED" ? "重新分配" : "分配供应商"}</button></> : null}
        {actionAllowed(selected.status, "start") ? <><label><span>配置备注</span><textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} /></label><button className="admin-button primary" disabled={busy !== null} onClick={() => void transition("start")} type="button">{busy === "start" ? "更新中…" : "开始配置"}</button></> : null}
        {actionAllowed(selected.status, "mark-delivered") ? <><label><span>SSH 主机</span><input type="text" value={host} onChange={(event) => setHost(event.target.value)} /></label><label><span>端口</span><input min="1" max="65535" type="number" value={port} onChange={(event) => setPort(event.target.value)} /></label><label><span>用户名</span><input type="text" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label><span>Host Key 指纹</span><input required type="text" value={hostKeyFingerprint} onChange={(event) => setHostKeyFingerprint(event.target.value)} /></label><label><span>买家可见说明</span><textarea value={buyerVisibleNote} onChange={(event) => setBuyerVisibleNote(event.target.value)} /></label><label><span>内部备注</span><textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} /></label><button className="admin-button primary" disabled={busy !== null || !host.trim() || !username.trim() || !hostKeyFingerprint.trim()} onClick={() => void transition("mark-delivered")} type="button">{busy === "mark-delivered" ? "提交中…" : "标记已交付"}</button></> : null}
        {actionAllowed(selected.status, "cancel") || actionAllowed(selected.status, "revoke") ? <><label><span>{actionAllowed(selected.status, "cancel") ? "取消原因" : "撤权原因"}</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="admin-button danger" disabled={busy !== null || reason.trim().length < 4} onClick={() => void transition(actionAllowed(selected.status, "cancel") ? "cancel" : "revoke")} type="button">{busy === "cancel" || busy === "revoke" ? "处理中…" : actionAllowed(selected.status, "cancel") ? "取消任务" : "撤销访问权限"}</button></> : null}
        {selected.connection ? <div className="admin-inline-success"><strong>已保存结构化连接入口</strong><span>{selected.connection.username}@{selected.connection.host}:{selected.connection.port}{selected.connection.hostKeyFingerprint ? ` · ${selected.connection.hostKeyFingerprint}` : ""}</span></div> : null}
        {notice ? <div className="admin-inline-success" role="status"><strong>操作完成</strong><span>{notice}</span></div> : null}
      </div>
    </section> : null}
  </section>;
}
