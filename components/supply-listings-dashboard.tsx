"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { marketplaceErrorMessage } from "@/lib/client/marketplace-client";
import {
  getSupplyDashboard,
  supplyApiUnavailable,
  type SupplyDashboard,
  type SupplyPool,
  type SupplyPublicationPlan,
  type SupplyTrialOrder,
  type SupplyVerificationJob,
} from "@/components/supply-api-client";

function kind(pool: SupplyPool | undefined) {
  return pool?.assetKind ?? "UNKNOWN";
}

function money(cents: number) {
  return `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function SupplyListingsDashboard() {
  const [pools, setPools] = useState<SupplyPool[]>([]);
  const [jobs, setJobs] = useState<SupplyVerificationJob[]>([]);
  const [plans, setPlans] = useState<SupplyPublicationPlan[]>([]);
  const [orders, setOrders] = useState<SupplyTrialOrder[]>([]);
  const [paymentReadiness, setPaymentReadiness] = useState<SupplyDashboard["paymentReadiness"]>({ provider: "ALIPAY", environment: "LIVE", ready: false, blockers: ["尚未读取支付状态"] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const dashboard = await getSupplyDashboard();
      setPools(dashboard.pools);
      setJobs(dashboard.verificationJobs);
      setPlans(dashboard.publicationPlans);
      setOrders(dashboard.orders);
      setPaymentReadiness(dashboard.paymentReadiness);
    } catch (loadError) {
      setError(supplyApiUnavailable(loadError)
        ? "上架计划 API 尚未就绪；当前不会展示静态挂牌或模拟支付状态。"
        : marketplaceErrorMessage(loadError, "暂时无法读取上架计划与订单。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getSupplyDashboard()
      .then((dashboard) => {
        if (cancelled) return;
        setPools(dashboard.pools);
        setJobs(dashboard.verificationJobs);
        setPlans(dashboard.publicationPlans);
        setOrders(dashboard.orders);
        setPaymentReadiness(dashboard.paymentReadiness);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(supplyApiUnavailable(loadError)
          ? "上架计划 API 尚未就绪；当前不会展示静态挂牌或模拟支付状态。"
          : marketplaceErrorMessage(loadError, "暂时无法读取上架计划与订单。"));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const poolById = useMemo(() => new Map(pools.map((pool) => [pool.id, pool])), [pools]);
  const latestJobByPool = useMemo(() => {
    const map = new Map<string, SupplyVerificationJob>();
    for (const job of jobs) {
      const current = map.get(job.poolId);
      if (!current || Date.parse(job.completedAt ?? job.createdAt) > Date.parse(current.completedAt ?? current.createdAt)) map.set(job.poolId, job);
    }
    return map;
  }, [jobs]);

  return (
    <div className="shell py-10 sm:py-14">
      <section aria-labelledby="listing-title">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="kicker">Publication control</p>
            <h2 className="section-heading" id="listing-title">上架计划</h2>
            <p className="section-lead text-base">发布计划是价格、8 卡粒度与交付方式的冻结预览，不等同于已公开成交。</p>
          </div>
          <button className="button button-secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? "正在刷新…" : "刷新状态"}</button>
        </div>

        <div className="mt-7 border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-5">
          <strong className="text-[var(--ink)]">{paymentReadiness.ready ? "支付宝 LIVE 安全门已由服务端确认" : "成交总闸仍关闭"}</strong>
          <p className="mb-0 mt-1 text-sm">{paymentReadiness.ready ? "仍需资源验真、库存窗口和整机粒度全部通过，才能进入成交。" : `服务端阻断：${paymentReadiness.blockers.join("；") || "支付宝生产配置未就绪"}。Mac mini 的发布权限始终为关闭。`}</p>
        </div>
        {error ? <div className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-5 text-[var(--error)]" role="alert">{error}</div> : null}

        {loading && plans.length === 0 ? <p className="mt-6 border-l-2 border-[var(--accent)] pl-4" role="status">正在读取发布计划和订单…</p> : null}
        {!loading && !error && plans.length === 0 ? (
          <div className="mt-7 border-y border-[var(--border)] bg-[var(--surface)] p-10 text-center">
            <h3 className="m-0 text-2xl">尚无服务端发布计划</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text)]">H100 申报会生成发布预览；验真不通过时计划不会变成可成交挂牌。</p>
            <Link className="button button-primary mt-5" href="/supply/h100/new">新建 H100 资源池</Link>
          </div>
        ) : null}

        {plans.length > 0 ? (
          <div className="mt-7 grid gap-5 lg:grid-cols-2">
            {plans.map((plan) => {
              const pool = poolById.get(plan.poolId);
              const verification = latestJobByPool.get(plan.poolId);
              const isMac = kind(pool) === "MAC_MINI";
              const verified = Boolean(pool && pool.memberCount > 0 && pool.verifiedCount === pool.memberCount);
              const reasons = [
                ...(!verified ? ["资源验真未通过"] : []),
                ...(isMac ? ["Mac mini 首期禁止成交"] : paymentReadiness.ready ? [] : paymentReadiness.blockers),
              ];
              return (
                <article className="border-t-4 border-[var(--accent)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)]" key={plan.id}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div><span className="font-mono text-xs text-[var(--muted)]">{plan.id}</span><h3 className="mb-0 mt-2 text-2xl">{pool?.name ?? plan.poolId}</h3></div>
                    <span className="border border-[var(--border)] bg-[var(--info-bg)] px-3 py-2 text-sm font-semibold">{plan.status}</span>
                  </div>
                  <dl className="mt-5 grid gap-px bg-[var(--border)] sm:grid-cols-2">
                    <div className="bg-[var(--info-bg)] p-4"><dt>价格</dt><dd className="m-0 font-semibold text-[var(--ink)]">{plan.unitPriceMicrosPerGpuHour ? `¥${plan.unitPriceMicrosPerGpuHour / 1_000_000} / 卡时` : "待服务端返回"}</dd></div>
                    <div className="bg-[var(--info-bg)] p-4"><dt>购买粒度</dt><dd className="m-0 font-semibold text-[var(--ink)]">固定 {plan.gpuCount ?? 8} 卡</dd></div>
                    <div className="bg-[var(--info-bg)] p-4"><dt>验真</dt><dd className="m-0 font-semibold text-[var(--ink)]">{verification?.status ?? (verified ? "已通过" : "未通过")}</dd></div>
                    <div className="bg-[var(--info-bg)] p-4"><dt>交付</dt><dd className="m-0 font-semibold text-[var(--ink)]">整机独占 SSH</dd></div>
                  </dl>
                  <div className="mt-5 border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-4 text-sm">
                    <strong className="block text-[var(--ink)]">当前不可成交</strong>
                    <ul className="mb-0 mt-2 pl-5">{[...new Set(reasons)].map((reason) => <li key={reason}>{reason}</li>)}</ul>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="mt-14 border-t border-[var(--border)] pt-10" aria-labelledby="supply-orders-title">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="kicker">Supplier orders</p><h2 className="section-heading" id="supply-orders-title">供应订单</h2></div>
          <span className="text-sm text-[var(--muted)]">{orders.length} 笔服务端订单</span>
        </div>
        {orders.length === 0 ? <p className="mt-5 bg-[var(--info-bg)] p-5 text-sm">当前供应会话没有订单。支付阻断不会生成虚假成交记录。</p> : (
          <div className="mt-6 overflow-x-auto border border-[var(--border)]">
            <table className="data-table min-w-[760px]">
              <caption className="sr-only">供应方订单</caption>
              <thead><tr><th scope="col">订单</th><th scope="col">状态</th><th className="num" scope="col">卡数</th><th className="num" scope="col">金额</th><th scope="col">支付环境</th><th scope="col">操作</th></tr></thead>
              <tbody>{orders.map((order) => <tr key={order.id}><th scope="row" className="font-mono text-xs">{order.id}</th><td>{order.status}</td><td className="num">{order.gpuCount}</td><td className="num">{money(order.amountCents)}</td><td>{paymentReadiness.ready ? "ALIPAY / LIVE" : "生产支付阻断"}</td><td><Link className="font-semibold text-[var(--accent)] underline" href={`/supply/orders/${encodeURIComponent(order.id)}?role=supplier`}>查看订单</Link></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
