"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminApiError, adminErrorMessage, adminGetJson, adminGetRows, type AdminRow } from "@/components/admin-api-client";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin-states";

type RevealedKey = Readonly<{
  canonicalSshPublicKey: string;
  sshPublicKeyFingerprint: string;
}>;

function text(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function dateTime(value: unknown) {
  if (typeof value !== "string") return "—";
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString("zh-CN");
}

export function AdminManualDeliveryIntakes() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [revealed, setRevealed] = useState<Record<string, RevealedKey>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await adminGetRows({ path: "/api/v1/admin/manual-deliveries" }));
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void adminGetRows({ path: "/api/v1/admin/manual-deliveries" })
      .then((items) => { if (!cancelled) setRows(items); })
      .catch((loadError: unknown) => { if (!cancelled) setError(loadError); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function reveal(demandId: string) {
    setRevealing(demandId);
    setError(null);
    setNotice("");
    try {
      const payload = await adminGetJson(`/api/v1/admin/manual-deliveries/${encodeURIComponent(demandId)}/ssh-public-key`);
      const record = payload.record;
      if (!record || typeof record !== "object" || Array.isArray(record)) throw new AdminApiError("公钥响应格式无效。", 200, "INVALID_RESPONSE");
      const value = record as Record<string, unknown>;
      if (typeof value.canonicalSshPublicKey !== "string" || typeof value.sshPublicKeyFingerprint !== "string") throw new AdminApiError("公钥响应缺少必要字段。", 200, "INVALID_RESPONSE");
      setRevealed((current) => ({ ...current, [demandId]: { canonicalSshPublicKey: value.canonicalSshPublicKey as string, sshPublicKeyFingerprint: value.sshPublicKeyFingerprint as string } }));
    } catch (revealError) {
      setError(revealError);
    } finally {
      setRevealing(null);
    }
  }

  async function copyKey(demandId: string) {
    const key = revealed[demandId]?.canonicalSshPublicKey;
    if (!key) return;
    await navigator.clipboard.writeText(key);
    setNotice(`申请 ${demandId} 的公钥已复制；请只交给本单指定供应商。`);
  }

  return (
    <section className="admin-manual-delivery" aria-labelledby="manual-delivery-title">
      <div className="admin-manual-delivery-head">
        <div><p className="admin-kicker">Manual SSH delivery</p><h2 id="manual-delivery-title">人工 SSH 交付申请</h2><span>公钥默认隐藏。查看原文需要交付权限并会写入审计记录。</span></div>
        <button className="admin-button secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? "读取中…" : "刷新申请"}</button>
      </div>
      {loading && rows.length === 0 ? <AdminLoading /> : null}
      {error ? <AdminError message={adminErrorMessage(error, "暂时无法读取人工交付申请。")} onRetry={() => void load()} /> : null}
      {!loading && !error && rows.length === 0 ? <AdminEmpty description="买家提交需要 SSH 交付的目录询价后，申请会出现在这里。" title="暂无人工交付申请" /> : null}
      {rows.length > 0 ? <div className="admin-table-wrap"><table className="admin-table"><caption>待人工交付的买家公钥申请</caption><thead><tr><th>申请</th><th>买家主体</th><th>资源</th><th>公钥指纹</th><th>提交时间</th><th>操作</th></tr></thead><tbody>{rows.map((row) => {
        const demandId = text(row.demandId);
        const key = revealed[demandId];
        return <tr key={demandId}><td className="admin-mono">{demandId}</td><td><strong>{text(row.organizationName, text(row.buyerDisplayName))}</strong><br /><small>{text(row.buyerEmail, text(row.buyerAccountId))}</small></td><td><strong>{text(row.resourceTitle)}</strong><br /><small>{text(row.resourceId)}</small></td><td className="admin-mono">{text(row.sshPublicKeyFingerprint)}</td><td>{dateTime(row.createdAt)}</td><td><button className="admin-button secondary" disabled={revealing === demandId} onClick={() => void reveal(demandId)} type="button">{revealing === demandId ? "读取中…" : key ? "重新查看" : "查看公钥"}</button>{key ? <div className="admin-manual-key"><code>{key.canonicalSshPublicKey}</code><button className="admin-button secondary" onClick={() => void copyKey(demandId)} type="button">复制公钥</button></div> : null}</td></tr>;
      })}</tbody></table></div> : null}
      {notice ? <div className="admin-inline-success" role="status"><strong>已复制</strong><span>{notice}</span></div> : null}
    </section>
  );
}
