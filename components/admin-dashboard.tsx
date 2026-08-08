"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminApiError, adminErrorMessage, adminGetDashboard, adminGetRows, type AdminRow } from "@/components/admin-api-client";
import { AdminPageHeader } from "@/components/admin-page-header";
import { AdminEmpty, AdminError, AdminLoading, AdminLoginRequired } from "@/components/admin-states";

type Dashboard = Record<string, unknown>;

function nested(data: Dashboard, paths: string[]) {
  for (const path of paths) {
    let current: unknown = data;
    for (const part of path.split(".")) {
      if (!current || typeof current !== "object" || Array.isArray(current)) { current = undefined; break; }
      current = (current as Record<string, unknown>)[part];
    }
    if (current !== undefined && current !== null) return current;
  }
  return undefined;
}

function numberText(value: unknown, money = false, percent = false) {
  if (typeof value !== "number") return "—";
  if (money) return `¥${(value / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (percent) return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}%`;
  return value.toLocaleString("zh-CN");
}

function objectRows(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

const metrics = [
  { label: "供给记录", paths: ["counts.supply-offers"], href: "/admin/supply-offers" },
  { label: "验真任务", paths: ["counts.verifications"], href: "/admin/verifications" },
  { label: "容量批次", paths: ["counts.capacity-lots"], href: "/admin/capacity-lots" },
  { label: "有效挂牌", paths: ["counts.listings"], href: "/admin/listings" },
  { label: "买方需求", paths: ["counts.demands"], href: "/admin/demands" },
  { label: "容量置换", paths: ["counts.swaps"], href: "/admin/swaps" },
  { label: "订单记录", paths: ["counts.orders"], href: "/admin/orders" },
  { label: "交付任务", paths: ["counts.delivery"], href: "/admin/delivery" },
  { label: "计量会话", paths: ["counts.metering"], href: "/admin/metering" },
  { label: "结算记录", paths: ["counts.settlements"], href: "/admin/settlements" },
  { label: "KAI-SCH 快照", paths: ["counts.standardization"], href: "/admin/standardization" },
  { label: "开放待办", paths: ["openWorkItems"], href: "/admin/work-items" },
  { label: "待审批退款", paths: ["pendingRefundApprovals"], href: "/admin/payments/refunds", critical: true },
] as const;

async function dashboardBundle() {
  const [dashboard, workItems] = await Promise.all([
    adminGetDashboard(),
    adminGetRows({ path: "/api/v1/admin/work-items" }),
  ]);
  return { dashboard, workItems };
}

export function AdminDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [workItems, setWorkItems] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { const result = await dashboardBundle(); setData(result.dashboard); setWorkItems(result.workItems); } catch (loadError) { setError(loadError); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void dashboardBundle()
      .then((result) => { if (!cancelled) { setData(result.dashboard); setWorkItems(result.workItems); } })
      .catch((loadError: unknown) => { if (!cancelled) setError(loadError); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (error instanceof AdminApiError && [401, 403].includes(error.status)) return <AdminLoginRequired forbidden={error.status === 403} />;

  const exceptions = data ? objectRows(nested(data, ["exceptions", "criticalExceptions", "alerts"])) : [];
  const funnel = data && nested(data, ["counts"]);
  const funnelEntries = funnel && typeof funnel === "object" && !Array.isArray(funnel)
    ? Object.entries(funnel as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number")
    : [];

  return (
    <div className="admin-page">
      <AdminPageHeader
        actions={<button className="admin-button secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? "读取中…" : "刷新总览"}</button>}
        description="从供应商上架、买方需求和验真，到匹配、支付、交付与异常的服务端运营视图。"
        kicker="Operations command center"
        title="运营总览"
      />

      {loading && !data ? <AdminLoading label="正在读取管理员总览…" /> : null}
      {error ? <AdminError message={adminErrorMessage(error, "暂时无法读取管理员总览。") } onRetry={() => void load()} /> : null}

      {data ? (
        <>
          <section className="admin-metric-grid" aria-label="关键运营指标">
            {metrics.map((metric) => (
              <Link className={"critical" in metric && metric.critical ? "critical" : ""} href={metric.href} key={metric.label}>
                <span>{metric.label}</span>
                <strong>{numberText(nested(data, [...metric.paths]))}</strong>
                <small>查看明细 →</small>
              </Link>
            ))}
          </section>

          <div className="admin-dashboard-grid">
            <section className="admin-panel admin-panel-wide" aria-labelledby="admin-work-title">
              <div className="admin-panel-head"><div><p className="admin-kicker">SLA queue</p><h2 id="admin-work-title">我的待办</h2></div><Link href="/admin/work-items">全部待办</Link></div>
              {workItems.length === 0 ? <AdminEmpty description="总览接口没有返回待办投影。" title="没有待办数据" /> : (
                <div className="admin-compact-list">{workItems.slice(0, 6).map((item, index) => <article key={String(item.id ?? index)}><div><strong>{String(item.title ?? item.summary ?? item.type ?? "未命名待办")}</strong><span>{String(item.objectId ?? item.targetId ?? "未返回关联对象")}</span></div><div><b>{String(item.priority ?? item.severity ?? "—")}</b><time>{typeof item.dueAt === "string" ? new Date(item.dueAt).toLocaleString("zh-CN") : "无 SLA"}</time></div></article>)}</div>
              )}
            </section>

            <section className="admin-panel" aria-labelledby="admin-funnel-title">
              <div className="admin-panel-head"><div><p className="admin-kicker">Coverage</p><h2 id="admin-funnel-title">业务对象覆盖</h2></div></div>
              {funnelEntries.length === 0 ? <AdminEmpty description="总览接口没有返回对象计数。" title="没有覆盖数据" /> : <ol className="admin-funnel">{funnelEntries.map(([label, value], index) => <li key={label}><span>{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong><b>{value.toLocaleString("zh-CN")}</b></li>)}</ol>}
            </section>

            <section className="admin-panel" aria-labelledby="admin-exception-title">
              <div className="admin-panel-head"><div><p className="admin-kicker">Risk alerts</p><h2 id="admin-exception-title">严重异常</h2></div><Link href="/admin/exceptions">异常中心</Link></div>
              {exceptions.length === 0 ? <AdminEmpty description="总览接口没有返回严重异常。" title="没有异常投影" /> : <div className="admin-alert-list">{exceptions.slice(0, 6).map((item, index) => <article key={String(item.id ?? item.code ?? index)}><span>{String(item.severity ?? item.priority ?? "异常")}</span><div><strong>{String(item.title ?? item.summary ?? item.message ?? "未命名异常")}</strong><small>{String(item.objectId ?? item.orderId ?? item.code ?? "—")}</small></div></article>)}</div>}
            </section>
          </div>
        </>
      ) : !loading && !error ? <AdminEmpty description="总览接口没有返回业务数据。" title="暂无管理员总览" /> : null}
    </div>
  );
}
