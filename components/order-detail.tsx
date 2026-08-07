"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClaimDeliveryPackageResult,
  ConnectionCheck,
  DeliveryPackage,
  ExchangeOrder,
} from "@/lib/exchange";
import {
  createIdempotencyKey,
  exchangeGet,
  exchangePost,
  MarketplaceApiError,
  marketplaceErrorMessage,
} from "@/lib/client/marketplace-client";
import { capacityDisplay, formatCapacityHours, formatRateUnits } from "@/lib/capacity-display";

const stages = ["待确认", "待支付", "开通中", "待验收", "已完成"] as const;

function stageIndex(order: ExchangeOrder) {
  const index = stages.indexOf(order.userPhase as (typeof stages)[number]);
  return index < 0 ? 0 : index;
}

function capacityLabel(order: ExchangeOrder) {
  if (order.reservation.state === "HELD") return "容量已预留";
  if (order.reservation.state === "SUPPLIER_CONFIRMED") return "供应商已确认";
  if (order.reservation.state === "COMMITTED") return "成交容量已锁定";
  if (order.reservation.state === "IN_SERVICE") return "服务中";
  if (order.reservation.state === "FULFILLED") return "服务已完成";
  return "容量已释放或异常";
}

function connectionStatus(check: ConnectionCheck) {
  if (check.status === "PASSED") return "连接可达（测试）";
  if (check.status === "FAILED") return "测试连接未通过";
  return "测试连接检查中";
}

function mayHaveReachedServer(error: unknown) {
  return error instanceof MarketplaceApiError && ["NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(error.code);
}

function money(cents: number) {
  return `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function availabilityLabel(ppm: number | null) {
  return ppm === null ? "—" : `${(ppm / 10_000).toLocaleString("zh-CN", { maximumFractionDigits: 4 })}%`;
}

async function evidenceDigest(value: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function OrderDetail({ orderId, role }: { orderId: string; role: "buyer" | "supplier" }) {
  const [order, setOrder] = useState<ExchangeOrder | null>(null);
  const [claimResult, setClaimResult] = useState<ClaimDeliveryPackageResult | null>(null);
  const [connectionCheck, setConnectionCheck] = useState<ConnectionCheck | null>(null);
  const [claimConfirmed, setClaimConfirmed] = useState(false);
  const [claimAttempted, setClaimAttempted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const paymentKey = useRef<string | null>(null);
  const connectionKey = useRef<string | null>(null);
  const acceptanceKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await exchangeGet<{ record: ExchangeOrder }>(`/api/v1/orders/${encodeURIComponent(orderId)}`, role);
      setOrder(result.record);
      const freshPackage = result.record.delivery?.package;
      if (freshPackage?.latestConnectionCheck) setConnectionCheck(freshPackage.latestConnectionCheck);
      setClaimResult((current) => current && freshPackage ? { ...current, package: freshPackage } : current);
    } catch (loadError) {
      setError(marketplaceErrorMessage(loadError, "订单暂时无法加载。"));
    } finally {
      setLoading(false);
    }
  }, [orderId, role]);

  useEffect(() => {
    let cancelled = false;
    exchangeGet<{ record: ExchangeOrder }>(`/api/v1/orders/${encodeURIComponent(orderId)}`, role)
      .then((result) => {
        if (cancelled) return;
        setOrder(result.record);
        setConnectionCheck(result.record.delivery?.package?.latestConnectionCheck ?? null);
      })
      .catch((loadError) => {
        if (!cancelled) setError(marketplaceErrorMessage(loadError, "订单暂时无法加载。"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, role]);

  async function runTestPayment() {
    if (!order) return;
    setBusy(true);
    setError("");
    setNotice("");
    paymentKey.current ??= createIdempotencyKey("test-payment");
    try {
      const result = await exchangePost<ExchangeOrder>(
        `/api/v1/orders/${encodeURIComponent(order.id)}/test-payment`,
        "buyer",
        { expectedVersion: order.version },
        paymentKey.current,
      );
      paymentKey.current = null;
      setOrder(result.record);
      setNotice("测试支付事件已确认，未产生真实扣款；订单已进入开通流程。");
    } catch (submitError) {
      await load();
      setError(marketplaceErrorMessage(submitError, "测试支付状态暂时无法确认，已刷新订单，请核对后重试。"));
    } finally {
      setBusy(false);
    }
  }

  async function claimTestCode(deliveryPackage: DeliveryPackage) {
    if (!claimConfirmed || claimAttempted) return;
    setClaimAttempted(true);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await exchangePost<ClaimDeliveryPackageResult>(
        `/api/v1/delivery-packages/${encodeURIComponent(deliveryPackage.id)}/claim`,
        "buyer",
        { expectedVersion: deliveryPackage.version },
        createIdempotencyKey("claim-test-code"),
      );
      setClaimResult(result.record);
      setOrder((current) => current?.delivery ? {
        ...current,
        delivery: { ...current.delivery, package: result.record.package },
      } : current);
      setNotice("一次性 TEST code 已领取。请现在保存；刷新或离开本页后不会再次显示。");
    } catch (claimError) {
      await load();
      if (claimError instanceof MarketplaceApiError && claimError.status < 500 && claimError.status !== 410) {
        setClaimAttempted(false);
      }
      setError(marketplaceErrorMessage(
        claimError,
        "一次性领取没有返回可显示内容。系统已刷新状态；若已显示为领取，TEST code 无法再次查看。",
      ));
    } finally {
      setBusy(false);
    }
  }

  async function runConnectionTest(deliveryPackage: DeliveryPackage) {
    setBusy(true);
    setError("");
    setNotice("");
    connectionKey.current ??= createIdempotencyKey("test-delivery-connection");
    try {
      const result = await exchangePost<ConnectionCheck>(
        `/api/v1/delivery-packages/${encodeURIComponent(deliveryPackage.id)}/connection-tests`,
        "buyer",
        { expectedVersion: deliveryPackage.version },
        connectionKey.current,
      );
      connectionKey.current = null;
      setConnectionCheck(result.record);
      setNotice(result.record.status === "PASSED"
        ? "测试入口连接可达。该结果不代表开始计费、服务完成或最终验收。"
        : "测试连接未通过；本次结果不会开始计费，也不代表服务完成或最终验收。");
      await load();
    } catch (testError) {
      if (!mayHaveReachedServer(testError)) connectionKey.current = null;
      await load();
      setError(marketplaceErrorMessage(testError, "测试连接暂时无法完成，请按页面最新状态重试。"));
    } finally {
      setBusy(false);
    }
  }

  async function copyTestCode() {
    if (!claimResult?.testCode) return;
    try {
      await navigator.clipboard.writeText(claimResult.testCode);
      setNotice("一次性 TEST code 已复制。请仅用于本次测试连接，不要转发或作为生产凭据使用。");
    } catch {
      setError("浏览器无法复制，请手动保存当前显示的 TEST code；离开本页后不会再次显示。");
    }
  }

  async function decideAcceptance(decision: "ACCEPT" | "DISPUTE") {
    if (!order?.acceptance) return;
    const reason = decision === "ACCEPT"
      ? "交付资源与平台计量结果符合订单约定，买方确认验收。"
      : disputeReason.trim();
    if (decision === "DISPUTE" && reason.length < 8) {
      setError("发起争议前，请填写至少 8 个字的具体问题和期望处理方式。");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    acceptanceKey.current ??= createIdempotencyKey(`acceptance-${decision.toLowerCase()}`);
    try {
      const result = await exchangePost<ExchangeOrder>(
        `/api/v1/orders/${encodeURIComponent(order.id)}/acceptances`,
        "buyer",
        {
          expectedVersion: order.acceptance.version,
          decision,
          reason,
          evidenceDigest: await evidenceDigest({ decision, reason }),
        },
        acceptanceKey.current,
      );
      acceptanceKey.current = null;
      setOrder(result.record);
      setNotice(decision === "ACCEPT"
        ? "验收已确认。平台可据此计算测试结算台账，但不会发生真实资金移动。"
        : "争议已登记。结算保持阻断，等待人工处理。");
    } catch (submitError) {
      if (!mayHaveReachedServer(submitError)) acceptanceKey.current = null;
      await load();
      setError(marketplaceErrorMessage(submitError, "验收状态暂时无法确认，已刷新订单，请核对后重试。"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="border-l-2 border-[var(--accent)] pl-4">正在读取订单进度…</p>;
  if (error && !order) return <div role="alert" className="border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-5 text-[var(--error)]">{error}</div>;
  if (!order) return null;

  const currentStage = stageIndex(order);
  const testPayment = order.payment?.provider === "SIMULATED" && order.payment.environment === "TEST";
  const deliveryPackage = claimResult?.package ?? order.delivery?.package ?? null;
  const packageActions = new Set([...(order.allowedActions ?? []), ...(deliveryPackage?.allowedActions ?? [])]);
  const latestCheck = connectionCheck ?? deliveryPackage?.latestConnectionCheck ?? null;
  const metering = order.metering;
  const acceptance = order.acceptance;
  const settlement = order.settlement;
  const vocabulary = capacityDisplay(order.productCode);

  return (
    <section className="border-t-4 border-[var(--accent)] bg-[var(--surface)] p-7 sm:p-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="kicker m-0">订单 {order.id}</p>
        <button type="button" className="button button-secondary" onClick={() => void load()}>刷新进度</button>
      </div>
      {testPayment ? (
        <div className="mt-5 border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-5">
          <strong>测试支付 · 不会扣款</strong>
          <p className="mb-0">当前未连接银行、支付宝或微信，不生成真实支付凭证，也不计入真实应收与结算。</p>
        </div>
      ) : null}
      {error ? <div role="alert" className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]">{error}</div> : null}
      {notice ? <div role="status" className="mt-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4">{notice}</div> : null}

      <div className="mt-7 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="m-0 text-4xl">{order.userPhase}</h1>
          <p className="section-lead">{formatRateUnits(order.productCode, order.rateUnits)} · {formatCapacityHours(order.productCode, order.capacityBaseUnits)}</p>
        </div>
        <div className="text-right">
          <strong className="font-mono text-3xl text-[var(--ink)]">¥{(order.totalAmountCents / 100).toFixed(2)}</strong>
          {testPayment ? <p className="m-0 text-sm">未产生真实扣款</p> : null}
        </div>
      </div>

      {order.allowedActions.includes("SIMULATE_PAYMENT") ? (
        <div className="mt-7 border-t-4 border-[var(--accent)] bg-[var(--accent-soft)] p-6">
          <p className="kicker">下一步</p>
          <h2 className="m-0 text-2xl">完成测试支付，进入开通</h2>
          <p>系统会再次核对订单金额与容量预留。本操作不会调用真实资金渠道。</p>
          <button type="button" className="button button-primary min-h-12 w-full justify-center sm:w-auto" disabled={busy} onClick={() => void runTestPayment()}>{busy ? "正在确认测试支付事件…" : `完成 ${money(order.totalAmountCents)} 测试支付`}</button>
        </div>
      ) : packageActions.has("CLAIM_DELIVERY_PACKAGE") ? (
        <div className="mt-7 border-t-4 border-[var(--accent)] bg-[var(--accent-soft)] p-6">
          <p className="kicker">下一步</p>
          <h2 className="m-0 text-2xl">领取测试连接信息</h2>
          <p>交付包已通过核验。领取前请准备安全位置保存一次性 TEST code。</p>
          <a className="button button-primary min-h-12 w-full justify-center sm:w-auto" href="#delivery-package">查看交付包并领取</a>
        </div>
      ) : acceptance?.status === "PENDING" ? (
        <div className="mt-7 border-t-4 border-[var(--accent)] bg-[var(--accent-soft)] p-6">
          <p className="kicker">下一步</p>
          <h2 className="m-0 text-2xl">核对计量并验收</h2>
          <p>确认可用容量、缺证容量和 SLA 结果后，选择验收或发起争议。</p>
          <a className="button button-primary min-h-12 w-full justify-center sm:w-auto" href="#final-acceptance">前往最终验收</a>
        </div>
      ) : null}

      <ol className="mt-7 grid gap-px bg-[var(--border)] sm:grid-cols-5" aria-label="订单进度">
        {stages.map((stage, index) => (
          <li key={stage} className={`p-4 ${index <= currentStage ? "bg-[var(--accent-soft)]" : "bg-[var(--info-bg)]"}`}>
            <span className="font-mono text-sm">0{index + 1}</span>
            <strong className="mt-1 block text-[var(--ink)]">{stage}</strong>
          </li>
        ))}
      </ol>

      <dl className="mt-8 grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["服务开始", new Date(order.startAt).toLocaleString("zh-CN")],
          ["服务结束", new Date(order.endAt).toLocaleString("zh-CN")],
          ["容量状态", capacityLabel(order)],
          ["订单更新", new Date(order.updatedAt).toLocaleString("zh-CN")],
        ].map(([label, value]) => (
          <div key={label} className="bg-[var(--info-bg)] p-5">
            <dt>{label}</dt>
            <dd className="m-0 font-semibold text-[var(--ink)]">{value}</dd>
          </div>
        ))}
      </dl>

      {metering ? (
        <section className="mt-7 border border-[var(--border)]" aria-labelledby="metering-title">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] p-6">
            <div>
              <p className="kicker">服务计量</p>
              <h2 id="metering-title" className="m-0 text-2xl">服务排期与{vocabulary.capacityFieldLabel}</h2>
            </div>
            <strong className="border border-[var(--border)] px-3 py-2">
              {metering.status === "SCHEDULED" ? "等待服务开始" : metering.status === "ACTIVE" ? "服务进行中" : "计量已完成"}
            </strong>
          </div>
          <dl className="grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-[var(--info-bg)] p-5">
              <dt>服务排期</dt>
              <dd className="m-0 font-semibold text-[var(--ink)]">
                {new Date(metering.scheduledStartAt).toLocaleString("zh-CN")}<br />
                至 {new Date(metering.scheduledEndAt).toLocaleString("zh-CN")}
              </dd>
            </div>
            <div className="bg-[var(--info-bg)] p-5">
              <dt>实际开始</dt>
              <dd className="m-0 font-semibold text-[var(--ink)]">
                {metering.actualStartAt ? new Date(metering.actualStartAt).toLocaleString("zh-CN") : "尚未开始"}
              </dd>
            </div>
            <div className="bg-[var(--accent-soft)] p-5">
              <dt>{vocabulary.availabilityLabel}</dt>
              <dd className="m-0 font-mono text-2xl font-semibold text-[var(--ink)]">
                {metering.status === "FINAL" ? formatCapacityHours(order.productCode, metering.availableCapacityBaseUnits) : "—"}
              </dd>
            </div>
            <div className="bg-[var(--info-bg)] p-5">
              <dt>缺少证据的{vocabulary.capacityFieldLabel}</dt>
              <dd className="m-0 font-mono text-2xl font-semibold text-[var(--ink)]">
                {metering.status === "FINAL" ? formatCapacityHours(order.productCode, metering.unprovenCapacityBaseUnits) : "—"}
              </dd>
            </div>
          </dl>
          <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
            <div className="bg-[var(--info-bg)] p-5">
              <strong>SLA 可用率结果</strong>
              <p className="mb-0 text-2xl font-semibold text-[var(--ink)]">
                {metering.status === "FINAL" ? availabilityLabel(metering.availabilityPpm) : "计量完成后生成"}
              </p>
            </div>
            <div className="bg-[var(--info-bg)] p-5">
              <strong>计量口径</strong>
              <p className="mb-0">按证据有效的服务时段 × {vocabulary.rateFieldLabel}计算；缺证时段单独列示，不计入可用容量。</p>
            </div>
          </div>
        </section>
      ) : null}

      {order.userPhase === "开通中" && !deliveryPackage ? (
        <div className="mt-7 bg-[var(--info-bg)] p-6">
          <h2 className="m-0 text-2xl">测试交付准备中</h2>
          <p className="mb-0">成交容量已锁定。供应商正在准备脱敏测试交付包，KAI 核验通过前没有可领取的测试连接信息。</p>
        </div>
      ) : null}

      {deliveryPackage?.status === "SUBMITTED" ? (
        <div className="mt-7 bg-[var(--info-bg)] p-6">
          <h2 className="m-0 text-2xl">KAI 正在核验测试交付包</h2>
          <p className="mb-0">当前只核对脱敏连接档案、有效期和订单一致性。核验通过后才会开放一次性 TEST code 领取。</p>
        </div>
      ) : null}

      {deliveryPackage?.status === "REJECTED" ? (
        <div className="mt-7 border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-6">
          <h2 className="m-0 text-2xl">测试交付包正在修改</h2>
          <p className="mb-0">上一版未通过 KAI 核验，供应商正在修正脱敏连接档案；当前没有可领取内容。</p>
        </div>
      ) : null}

      {deliveryPackage && ["VERIFIED", "CLAIMED"].includes(deliveryPackage.status) ? (
        <div id="delivery-package" className="mt-7 scroll-mt-28 border border-[var(--border)] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="kicker">测试交付包 · 第 {deliveryPackage.revision} 版</p>
              <h2 className="m-0 text-2xl">测试连接信息</h2>
            </div>
            <strong className="border border-[var(--border)] px-3 py-2">{deliveryPackage.status === "VERIFIED" ? "待领取" : "已领取"}</strong>
          </div>
          <dl className="mt-5 grid gap-px bg-[var(--border)] sm:grid-cols-2">
            {[
              ["环境", "TEST · 非生产环境"],
              ["连接方式", deliveryPackage.publicProfile.protocol],
              ["脱敏入口", `${deliveryPackage.publicProfile.endpointDisplay}:${deliveryPackage.publicProfile.port}`],
              ["用户名提示", deliveryPackage.publicProfile.usernameHint],
              ["地区", deliveryPackage.publicProfile.region],
              ["有效至", new Date(deliveryPackage.publicProfile.expiresAt).toLocaleString("zh-CN")],
            ].map(([label, value]) => (
              <div key={label} className="bg-[var(--info-bg)] p-4">
                <dt>{label}</dt>
                <dd className="m-0 break-words font-semibold text-[var(--ink)]">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-px bg-[var(--info-bg)] p-5">
            <strong>连接说明摘要</strong>
            <p className="mb-0">{deliveryPackage.publicProfile.instructionsSummary}</p>
          </div>

          {packageActions.has("CLAIM_DELIVERY_PACKAGE") && !claimResult ? (
            <div className="mt-6 border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-5">
              <strong>一次性领取</strong>
              <p>TEST code 只在首次成功响应中显示。刷新、关闭或离开本页后不能再次查看；请先准备好安全保存位置。</p>
              <label className="flex items-start gap-3">
                <input type="checkbox" checked={claimConfirmed} onChange={(event) => setClaimConfirmed(event.target.checked)} className="mt-1" />
                <span>我已准备立即保存，并理解 TEST code 只显示一次。</span>
              </label>
              <button type="button" className="button button-primary mt-5" disabled={busy || !claimConfirmed || claimAttempted} onClick={() => void claimTestCode(deliveryPackage)}>{busy ? "正在领取…" : "领取一次性 TEST code"}</button>
            </div>
          ) : null}

          {claimResult?.testCode ? (
            <div className="mt-6 border-t-4 border-[var(--accent)] bg-[var(--accent-soft)] p-5" role="status">
              <strong>一次性 TEST code · 仅显示本次</strong>
              <code className="mt-3 block [overflow-wrap:anywhere] border border-[var(--border)] bg-[var(--surface)] p-4 font-mono text-lg text-[var(--ink)]">{claimResult.testCode}</code>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" className="button button-secondary" onClick={() => void copyTestCode()}>复制 TEST code</button>
              </div>
              <p className="mb-0 mt-4">这不是生产密码或私钥。请勿转发；刷新或离开本页后平台不会再次显示。</p>
            </div>
          ) : null}

          {deliveryPackage.status === "CLAIMED" && !claimResult?.testCode ? (
            <div className="mt-6 bg-[var(--info-bg)] p-5">
              <strong>TEST code 已领取</strong>
              <p className="mb-0">为遵守一次性显示规则，本页不会再次返回内容。如果此前未保存，请联系 KAI 运营处理，当前页面不会伪造重领入口。</p>
            </div>
          ) : null}

          {packageActions.has("TEST_CONNECTION") ? (
            <div className="mt-6">
              <button type="button" className="button button-primary" disabled={busy || latestCheck?.status === "RUNNING"} onClick={() => void runConnectionTest(deliveryPackage)}>{busy || latestCheck?.status === "RUNNING" ? "正在运行测试…" : latestCheck?.status === "FAILED" ? "再次运行测试连接" : "运行平台测试连接"}</button>
              <p className="mb-0 mt-3 text-sm">测试请求不会从浏览器回传 TEST code，也不会开始计费、服务或验收。</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {deliveryPackage && ["EXPIRED", "REVOKED"].includes(deliveryPackage.status) ? (
        <div className="mt-7 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-6 text-[var(--error)]">
          <h2 className="m-0 text-2xl">测试交付包{deliveryPackage.status === "EXPIRED" ? "已过期" : "已撤销"}</h2>
          <p className="mb-0">当前不能领取或运行测试连接。请等待 KAI 运营和供应商处理最新交付版本。</p>
        </div>
      ) : null}

      {latestCheck ? (
        <div className={`mt-7 border-l-4 p-6 ${latestCheck.status === "PASSED" ? "border-[var(--success)] bg-[var(--success-bg)]" : latestCheck.status === "FAILED" ? "border-[var(--warning)] bg-[var(--warning-bg)]" : "border-[var(--accent)] bg-[var(--info-bg)]"}`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="kicker">交付可用性</p>
              <h2 className="m-0 text-2xl">{connectionStatus(latestCheck)}</h2>
            </div>
            <span className="font-mono text-sm">{latestCheck.diagnosticCode}</span>
          </div>
          <p>{latestCheck.summary}</p>
          <strong>连接测试只记录测试入口是否可达；不代表开始计费、服务完成或最终验收。</strong>
        </div>
      ) : null}

      {acceptance ? (
        <section id="final-acceptance" className="mt-7 scroll-mt-28 border-t-4 border-[var(--accent)] bg-[var(--info-bg)] p-6" aria-labelledby="acceptance-title">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="kicker">最终验收</p>
              <h2 id="acceptance-title" className="m-0 text-2xl">最终验收</h2>
            </div>
            <strong className="border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
              {acceptance.status === "PENDING" ? "待买方决定" : acceptance.status === "ACCEPTED" ? "已验收" : "争议处理中"}
            </strong>
          </div>

          {acceptance.status === "PENDING" ? (
            <div className="mt-5">
              <p>请先核对服务排期、{vocabulary.availabilityLabel}、缺证容量和可用率。确认后才能进入测试结算；发起争议会继续阻断结算。</p>
              <label className="field mt-4">
                <span>争议说明（发起争议时必填）</span>
                <textarea
                  rows={3}
                  minLength={8}
                  maxLength={500}
                  value={disputeReason}
                  onChange={(event) => setDisputeReason(event.target.value)}
                  placeholder="说明哪段服务、哪项计量或哪条 SLA 存在问题，以及期望平台如何处理。"
                />
              </label>
              <div className="mt-5 flex flex-wrap gap-3">
                {order.allowedActions.includes("ACCEPT_ORDER") ? (
                  <button type="button" className="button button-primary" disabled={busy} onClick={() => void decideAcceptance("ACCEPT")}>
                    {busy ? "正在提交…" : "确认验收"}
                  </button>
                ) : null}
                {order.allowedActions.includes("DISPUTE_ORDER") ? (
                  <button type="button" className="button button-secondary" disabled={busy} onClick={() => void decideAcceptance("DISPUTE")}>
                    发起争议并阻断结算
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className={`mt-5 border-l-4 p-5 ${acceptance.status === "ACCEPTED" ? "border-[var(--success)] bg-[var(--success-bg)]" : "border-[var(--warning)] bg-[var(--warning-bg)]"}`}>
              <strong>{acceptance.status === "ACCEPTED" ? "买方已确认最终验收" : "买方已发起争议，结算保持阻断"}</strong>
              <p className="mb-0">{acceptance.reason}</p>
            </div>
          )}
        </section>
      ) : null}

      {settlement ? (
        <section className="mt-7 border border-[var(--border)]" aria-labelledby="settlement-title">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] p-6">
            <div>
              <p className="kicker">测试结算台账</p>
              <h2 id="settlement-title" className="m-0 text-2xl">结算台账</h2>
            </div>
            <strong className="border border-[var(--border)] px-3 py-2">
              {settlement.status === "BLOCKED" ? "结算阻断" : settlement.status === "ELIGIBLE" ? "待记录" : "测试台账已记录"}
            </strong>
          </div>
          <dl className="grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-[var(--info-bg)] p-5">
              <dt>合同金额</dt>
              <dd className="m-0 font-mono text-xl font-semibold text-[var(--ink)]">{money(settlement.grossAmountCents)}</dd>
            </div>
            <div className="bg-[var(--info-bg)] p-5">
              <dt>基础冲减</dt>
              <dd className="m-0 font-mono text-xl font-semibold text-[var(--ink)]">-{money(settlement.baseCreditCents)}</dd>
            </div>
            <div className="bg-[var(--info-bg)] p-5">
              <dt>争议冲减</dt>
              <dd className="m-0 font-mono text-xl font-semibold text-[var(--ink)]">-{money(settlement.disputeCreditCents)}</dd>
            </div>
            <div className="bg-[var(--accent-soft)] p-5">
              <dt>供应商净应付</dt>
              <dd className="m-0 font-mono text-2xl font-semibold text-[var(--ink)]">{money(settlement.netSupplierPayableCents)}</dd>
            </div>
          </dl>
          <div className="border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-5">
            <strong>测试结算 · 未发生真实资金移动</strong>
            <p className="mb-0">本记录只验证金额派生、验收门槛和台账状态；不会向买方扣款，也不会向供应商划款。</p>
          </div>
        </section>
      ) : null}
    </section>
  );
}
