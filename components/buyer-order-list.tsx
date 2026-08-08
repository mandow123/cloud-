"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ExchangeOrder } from "@/lib/exchange";
import { formatCapacityHours, formatRateUnits } from "@/lib/capacity-display";
import { exchangeGet, marketplaceErrorMessage } from "@/lib/client/marketplace-client";

type ListResponse<T> = { items: T[]; count: number };

function money(cents: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function nextAction(order: ExchangeOrder) {
  if (order.allowedActions.includes("SIMULATE_PAYMENT")) return "完成支付";
  if (order.allowedActions.includes("CLAIM_DELIVERY_PACKAGE")) return "领取交付信息";
  if (order.allowedActions.includes("TEST_CONNECTION")) return "检查连接";
  if (order.allowedActions.includes("ACCEPT_ORDER")) return "确认验收";
  if (order.status === "PENDING_SUPPLIER_CONFIRMATION") return "等待供应商确认";
  if (order.status === "FULFILLING") return "查看开通进度";
  if (order.status === "COMPLETED") return "查看成交记录";
  return "查看订单";
}

export function BuyerOrderList() {
  const [orders, setOrders] = useState<ExchangeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const page = await exchangeGet<ListResponse<ExchangeOrder>>("/api/v1/orders", "buyer");
      setOrders(page.items);
    } catch (loadError) {
      setError(marketplaceErrorMessage(loadError, "采购订单暂时无法加载。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    exchangeGet<ListResponse<ExchangeOrder>>("/api/v1/orders", "buyer")
      .then((page) => {
        if (!cancelled) setOrders(page.items);
      })
      .catch((loadError) => {
        if (!cancelled) setError(marketplaceErrorMessage(loadError, "采购订单暂时无法加载。"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p role="status" className="border-l-2 border-[var(--accent)] pl-4">正在读取采购订单…</p>;

  return (
    <section aria-labelledby="buyer-orders-title">
      <div className="flex flex-wrap items-end justify-between gap-5 border-b border-[var(--border)] pb-6">
        <div>
          <p className="kicker">采购记录</p>
          <h1 id="buyer-orders-title" className="m-0 text-4xl sm:text-5xl">我的容量订单</h1>
          <p className="section-lead">查看供应商确认、支付、开通、计量与验收进度。</p>
        </div>
        <button className="button button-secondary" type="button" onClick={() => void load()}>刷新订单</button>
      </div>

      {error ? <div role="alert" className="mt-6 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-5 text-[var(--error)]">{error}</div> : null}
      {!error && orders.length === 0 ? (
        <div className="mt-8 border-y border-[var(--border)] bg-[var(--info-bg)] p-7">
          <h2 className="m-0 text-2xl">还没有容量订单</h2>
          <p>从已核验的在售资源中选择数量和连续服务时间，提交后会出现在这里。</p>
          <Link className="button button-primary min-h-12 w-full justify-center sm:w-auto" href="/market/listings">查看在售容量</Link>
        </div>
      ) : null}

      {orders.length ? (
        <div className="mt-8 grid gap-px bg-[var(--border)]">
          {orders.map((order) => (
            <article className="grid gap-5 bg-[var(--surface)] p-6 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center" key={order.id}>
              <div>
                <p className="m-0 font-mono text-sm text-[var(--accent)]">{order.id}</p>
                <h2 className="mb-0 mt-2 text-2xl">{order.userPhase}</h2>
                <p className="mb-0 mt-2">{formatRateUnits(order.productCode, order.rateUnits)} · {formatCapacityHours(order.productCode, order.capacityBaseUnits)}</p>
                <p className="mb-0 mt-1 text-sm">{new Date(order.startAt).toLocaleString("zh-CN")} 至 {new Date(order.endAt).toLocaleString("zh-CN")}</p>
              </div>
              <div className="lg:text-right">
                <span className="block text-sm">订单金额</span>
                <strong className="font-mono text-3xl text-[var(--ink)]">{money(order.totalAmountCents)}</strong>
              </div>
              <Link className="button button-primary min-h-12 w-full justify-center lg:w-auto" href={`/buyer/orders/${encodeURIComponent(order.id)}`}>{nextAction(order)}</Link>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
