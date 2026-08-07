"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExchangeOrder, TestSettlement } from "@/lib/exchange";
import {
  createIdempotencyKey,
  exchangeGet,
  exchangePost,
  MarketplaceApiError,
  marketplaceErrorMessage,
} from "@/lib/client/marketplace-client";
import { capacityDisplay, formatCapacityHours, formatRateUnits } from "@/lib/capacity-display";

type ListResponse<T> = { items: T[]; count: number };
type OpsAction = "TEST_START_SERVICE" | "TEST_COMPLETE_METERING" | "TEST_RECORD_SETTLEMENT";

function money(cents: number) {
  return `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function mayHaveReachedServer(error: unknown) {
  return error instanceof MarketplaceApiError && ["NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(error.code);
}

function actionTiming(order: ExchangeOrder, action: OpsAction, nowMs: number | null) {
  if (nowMs === null) return { disabled: true, hint: "正在校准服务时间…" };
  if (action === "TEST_START_SERVICE") {
    const startsAt = Date.parse(order.startAt);
    const endsAt = Date.parse(order.endAt);
    if (nowMs < startsAt) return { disabled: true, hint: `${new Date(order.startAt).toLocaleString("zh-CN")} 后可开始` };
    if (nowMs >= endsAt) return { disabled: true, hint: "固定服务窗口已经结束，不能补录开始" };
  }
  if (action === "TEST_COMPLETE_METERING" && nowMs < Date.parse(order.endAt)) {
    return { disabled: true, hint: `${new Date(order.endAt).toLocaleString("zh-CN")} 后可完成计量` };
  }
  return { disabled: false, hint: "" };
}

function orderFacts(order: ExchangeOrder) {
  const metering = order.metering;
  const settlement = order.settlement;
  if (!metering) return null;
  const vocabulary = capacityDisplay(order.productCode);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="m-0 font-mono text-sm text-[var(--accent)]">{order.id}</p>
          <h3 className="mb-0 mt-2 text-xl">{formatRateUnits(order.productCode, order.rateUnits)} · {formatCapacityHours(order.productCode, order.capacityBaseUnits)}</h3>
        </div>
        <strong className="border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          {metering.status === "SCHEDULED" ? "待开始" : metering.status === "ACTIVE" ? "服务中" : "计量完成"}
        </strong>
      </div>
      <dl className="mt-5 grid gap-px bg-[var(--border)] sm:grid-cols-2">
        <div className="bg-[var(--surface)] p-4">
          <dt>服务排期</dt>
          <dd className="m-0 font-semibold text-[var(--ink)]">
            {new Date(metering.scheduledStartAt).toLocaleString("zh-CN")}<br />
            至 {new Date(metering.scheduledEndAt).toLocaleString("zh-CN")}
          </dd>
        </div>
        <div className="bg-[var(--surface)] p-4">
          <dt>实际开始</dt>
          <dd className="m-0 font-semibold text-[var(--ink)]">
            {metering.actualStartAt ? new Date(metering.actualStartAt).toLocaleString("zh-CN") : "尚未开始"}
          </dd>
        </div>
        <div className="bg-[var(--surface)] p-4">
          <dt>可用 / 缺证{vocabulary.capacityFieldLabel}</dt>
          <dd className="m-0 font-mono font-semibold text-[var(--ink)]">
            {metering.status === "FINAL" ? `${formatCapacityHours(order.productCode, metering.availableCapacityBaseUnits)} / ${formatCapacityHours(order.productCode, metering.unprovenCapacityBaseUnits)}` : "计量完成后生成"}
          </dd>
        </div>
        <div className="bg-[var(--surface)] p-4">
          <dt>SLA 可用率结果</dt>
          <dd className="m-0 font-semibold text-[var(--ink)]">
            {metering.status === "FINAL" && metering.availabilityPpm !== null ? `${(metering.availabilityPpm / 10_000).toLocaleString("zh-CN", { maximumFractionDigits: 4 })}%` : "计量完成后生成"}
          </dd>
        </div>
      </dl>
      {settlement ? (
        <dl className="mt-px grid gap-px bg-[var(--border)] sm:grid-cols-3">
          <div className="bg-[var(--surface)] p-4">
            <dt>合同金额</dt>
            <dd className="m-0 font-mono font-semibold text-[var(--ink)]">{money(settlement.grossAmountCents)}</dd>
          </div>
          <div className="bg-[var(--surface)] p-4">
            <dt>基础冲减</dt>
            <dd className="m-0 font-mono font-semibold text-[var(--ink)]">-{money(settlement.baseCreditCents)}</dd>
          </div>
          <div className="bg-[var(--accent-soft)] p-4">
            <dt>供应商净应付</dt>
            <dd className="m-0 font-mono font-semibold text-[var(--ink)]">{money(settlement.netSupplierPayableCents)}</dd>
          </div>
        </dl>
      ) : null}
    </>
  );
}

export function OpsMeteringWorkspace() {
  const [orders, setOrders] = useState<ExchangeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nowMs, setNowMs] = useState<number | null>(null);
  const keys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setError("");
    try {
      const page = await exchangeGet<ListResponse<ExchangeOrder>>("/api/v1/ops/metering-orders", "ops");
      setOrders(page.items);
    } catch (loadError) {
      setError(marketplaceErrorMessage(loadError, "服务计量工作台暂时无法加载。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    exchangeGet<ListResponse<ExchangeOrder>>("/api/v1/ops/metering-orders", "ops")
      .then((page) => {
        if (!cancelled) setOrders(page.items);
      })
      .catch((loadError) => {
        if (!cancelled) setError(marketplaceErrorMessage(loadError, "服务计量工作台暂时无法加载。"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const updateClock = () => setNowMs(Date.now());
    updateClock();
    const intervalId = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  async function runAction(order: ExchangeOrder, action: OpsAction) {
    const metering = order.metering;
    const settlement = order.settlement;
    if (!metering) return;
    const config = action === "TEST_START_SERVICE"
      ? {
          path: `/api/v1/orders/${encodeURIComponent(order.id)}/test-service-start`,
          expectedVersion: metering.version,
          notice: "测试服务已开始；实际开始时间由服务端记录，浏览器未提交时间。",
        }
      : action === "TEST_COMPLETE_METERING"
        ? {
            path: `/api/v1/orders/${encodeURIComponent(order.id)}/test-meter-complete`,
            expectedVersion: metering.version,
            notice: `测试计量已完成；可用、缺证${capacityDisplay(order.productCode).capacityFieldLabel}和基础冲减均由服务端计算。`,
          }
        : settlement
          ? {
              path: `/api/v1/settlements/${encodeURIComponent(settlement.id)}/test-record`,
              expectedVersion: settlement.version,
              notice: "测试结算台账已记录，未发生真实资金移动。",
            }
          : null;
    if (!config) return;

    setBusyId(order.id);
    setError("");
    setNotice("");
    const scope = `${order.id}:${action}`;
    const key = keys.current.get(scope) ?? createIdempotencyKey(action.toLowerCase());
    keys.current.set(scope, key);
    try {
      if (action === "TEST_RECORD_SETTLEMENT") {
        await exchangePost<TestSettlement>(config.path, "ops", { expectedVersion: config.expectedVersion }, key);
      } else {
        await exchangePost<ExchangeOrder>(config.path, "ops", { expectedVersion: config.expectedVersion }, key);
      }
      keys.current.delete(scope);
      setNotice(config.notice);
      await load();
    } catch (submitError) {
      if (!mayHaveReachedServer(submitError)) keys.current.delete(scope);
      await load();
      setError(marketplaceErrorMessage(submitError, "操作状态暂时无法确认，已刷新工作台，请核对后重试。"));
    } finally {
      setBusyId("");
    }
  }

  const scheduled = orders.filter((order) => order.allowedActions.includes("TEST_START_SERVICE"));
  const active = orders.filter((order) => order.allowedActions.includes("TEST_COMPLETE_METERING"));
  const awaitingAcceptance = orders.filter((order) => order.metering?.status === "FINAL" && order.acceptance?.status === "PENDING");
  const settlementReady = orders.filter((order) => order.allowedActions.includes("TEST_RECORD_SETTLEMENT"));
  const recorded = orders.filter((order) => order.settlement?.status === "TEST_RECORDED");

  const group = (title: string, description: string, items: ExchangeOrder[], action?: OpsAction) => (
    <section className="mt-9">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="m-0 text-2xl">{title}</h3>
          <p className="mb-0 mt-2">{description}</p>
        </div>
        <span className="font-mono text-sm">{items.length} 笔</span>
      </div>
      {items.length === 0 ? <p className="mt-4 bg-[var(--info-bg)] p-5">当前没有符合此阶段的订单。</p> : (
        <div className="mt-4 grid gap-px bg-[var(--border)] lg:grid-cols-2">
          {items.map((order) => {
            const timing = action ? actionTiming(order, action, nowMs) : null;
            return (
              <article key={order.id} className="bg-[var(--info-bg)] p-6">
                {orderFacts(order)}
                {action ? (
                  <div className="mt-5">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={Boolean(busyId) || timing?.disabled}
                      onClick={() => void runAction(order, action)}
                    >
                      {busyId === order.id
                        ? "正在处理…"
                        : action === "TEST_START_SERVICE"
                          ? "开始测试服务"
                          : action === "TEST_COMPLETE_METERING"
                            ? "完成测试计量"
                            : "记录测试结算台账"}
                    </button>
                    {timing?.hint ? <p className="mb-0 mt-2 text-sm"><strong>{timing.hint}</strong></p> : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );

  return (
    <section id="service-metering" className="border-t border-[var(--border)] py-12 sm:py-16" aria-labelledby="ops-metering-title">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="kicker">服务、计量与结算</p>
          <h2 id="ops-metering-title" className="m-0 text-3xl">服务计量与测试结算</h2>
        </div>
        <button type="button" className="button button-secondary" onClick={() => void load()}>刷新工作台</button>
      </div>
      <p className="section-lead max-w-4xl">
        运营只触发状态动作。实际开始时间、可用与缺证容量、基础冲减和净应付均由服务端依据订单快照生成，不能在浏览器修改。
      </p>
      <div className="border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-5">
        <strong>当前为 TEST 服务与结算链路</strong>
        <p className="mb-0">用于验证交易状态、计量和台账；不会扣取买方资金，也不会向供应商划款。</p>
      </div>
      {error ? <div role="alert" className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]">{error}</div> : null}
      {notice ? <div role="status" className="mt-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4">{notice}</div> : null}
      {loading ? <p className="mt-6 border-l-2 border-[var(--accent)] pl-4">正在读取服务计量订单…</p> : null}
      {!loading ? (
        <>
          {group("待开始服务", "服务端将在执行时再次核对测试支付、交付核验、成交容量和固定服务时间窗。", scheduled, "TEST_START_SERVICE")}
          {group("服务进行中", "完成计量时由服务端固定实际结束时间，并派生可用、不可用与缺证时段。", active, "TEST_COMPLETE_METERING")}
          {group("等待买方验收", "运营不能替买方验收；争议未解决前不能记录结算。", awaitingAcceptance)}
          {group("待记录测试结算", "金额来自合同快照与服务计量结果，运营不能在页面输入或修改。", settlementReady, "TEST_RECORD_SETTLEMENT")}
          {group("已记录测试台账", "这些记录没有发生真实资金移动。", recorded)}
        </>
      ) : null}
    </section>
  );
}
