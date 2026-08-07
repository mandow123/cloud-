"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExchangeOrder, MarketListing } from "@/lib/exchange";
import { capacityDisplay, formatCapacityHours, formatRateUnits, formatStandardMonthComparison, formatUnitPrice } from "@/lib/capacity-display";
import { createIdempotencyKey, exchangeGet, exchangePost, MarketplaceApiError, marketplaceErrorMessage } from "@/lib/client/marketplace-client";

type ListingPage = { items: MarketListing[]; count: number };

function inputDate(iso: string) {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1_000);
  return local.toISOString().slice(0, 19);
}

function estimateTerms(listing: MarketListing, rateUnits: number, startAt: string, endAt: string) {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isSafeInteger(rateUnits) || rateUnits <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  const durationSeconds = Math.floor((end - start) / 1_000);
  const capacityBaseUnits = BigInt(rateUnits) * BigInt(durationSeconds);
  const denominator = BigInt(listing.priceBasisBaseUnits) * BigInt(10_000);
  const numerator = BigInt(listing.unitPriceMicros) * capacityBaseUnits;
  const amountCents = (numerator + denominator - BigInt(1)) / denominator;
  if (capacityBaseUnits > BigInt(Number.MAX_SAFE_INTEGER) || amountCents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return {
    durationSeconds,
    capacityBaseUnits: Number(capacityBaseUnits),
    amountCents: Number(amountCents),
  };
}

function money(cents: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function displayedRateUnits(productCode: MarketListing["productCode"], rateUnits: number) {
  return productCode === "TOKEN_THROUGHPUT"
    ? rateUnits / 1_000
    : productCode === "NAS_STORAGE"
      ? rateUnits / 1_024
      : rateUnits;
}

function canonicalRateUnits(productCode: MarketListing["productCode"], displayedValue: string) {
  const input = Number(displayedValue);
  const value = productCode === "TOKEN_THROUGHPUT"
    ? input * 1_000
    : productCode === "NAS_STORAGE"
      ? input * 1_024
      : input;
  return Number.isSafeInteger(value) ? value : 0;
}

function rateInputHint(productCode: MarketListing["productCode"]) {
  if (productCode === "TOKEN_THROUGHPUT") return "（百万 Token/小时）";
  if (productCode === "NAS_STORAGE") return "（TiB）";
  if (productCode === "RACK_SPACE") return "（整柜）";
  return "";
}

export function CapacityCheckout({ listingVersionId }: { listingVersionId: string }) {
  const [listing, setListing] = useState<MarketListing | null>(null);
  const [order, setOrder] = useState<ExchangeOrder | null>(null);
  const [rateUnits, setRateUnits] = useState(1);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyConflict, setIdempotencyConflict] = useState(false);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    exchangeGet<ListingPage>("/api/v1/market/listings", "buyer")
      .then((page) => {
        const found = page.items.find((item) => item.id === listingVersionId) ?? null;
        setListing(found);
        if (found) {
          setRateUnits(found.minRateUnits);
          setStartAt(inputDate(found.lot.startAt));
          setEndAt(inputDate(found.lot.endAt));
        }
      })
      .catch((loadError) => setError(marketplaceErrorMessage(loadError, "上架详情暂时无法加载。")))
      .finally(() => setLoading(false));
  }, [listingVersionId]);

  const estimate = useMemo(() => {
    if (!listing || !startAt || !endAt) return null;
    return estimateTerms(listing, rateUnits, startAt, endAt);
  }, [listing, rateUnits, startAt, endAt]);

  async function submit() {
    if (!listing) return;
    setBusy(true);
    setError("");
    setIdempotencyConflict(false);
    try {
      keyRef.current ??= createIdempotencyKey("capacity-checkout");
      const result = await exchangePost<ExchangeOrder>("/api/v1/checkouts", "buyer", {
        listingVersionId: listing.id,
        rateUnits,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        interruptibility: listing.resource.interruptibility,
      }, keyRef.current);
      keyRef.current = null;
      setOrder(result.record);
    } catch (submitError) {
      if (submitError instanceof MarketplaceApiError && submitError.status === 409) {
        setIdempotencyConflict(true);
      }
      setError(marketplaceErrorMessage(submitError, "容量锁定失败，请调整数量或服务时间后重试。"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="border-l-2 border-[var(--accent)] pl-4">正在读取报价与可售时间…</p>;
  if (error && !listing) return <div role="alert" className="border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-5 text-[var(--error)]">{error}</div>;
  if (!listing) return <div className="bg-[var(--warning-bg)] p-6"><h2 className="m-0 text-2xl">该报价当前不可购买</h2><p>报价可能已过期、撤回，或对应容量时间窗已经结束。</p><Link className="button button-secondary" href="/resources">返回资源市场</Link></div>;

  const vocabulary = capacityDisplay(listing.productCode);

  if (order) return (
    <section className="border-t-4 border-[var(--accent)] bg-[var(--success-bg)] p-7 sm:p-10" aria-labelledby="hold-success-title">
      <p className="kicker">容量锁定成功</p>
      <h2 id="hold-success-title" className="m-0 text-3xl">等待供应商确认交付</h2>
      <p className="section-lead">订单 {order.id} 已锁定 {formatRateUnits(order.productCode, order.rateUnits)}、{formatCapacityHours(order.productCode, order.capacityBaseUnits)}。供应商确认后才进入支付。</p>
      {order.referralDecision.outcome === "APPLIED" ? <p className="border-l-4 border-[var(--accent)] bg-[var(--info-bg)] p-4" role="status">TEST 推荐归因已记录，不影响订单价格。</p> : null}
      {order.referralDecision.outcome !== "NONE" && order.referralDecision.outcome !== "APPLIED" ? <p className="border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-4" role="status">订单已创建，本次推荐未归因。</p> : null}
      <dl className="grid gap-4 border-y border-[var(--border)] py-5 sm:grid-cols-3">
        <div><dt>当前阶段</dt><dd className="m-0 text-lg font-semibold text-[var(--ink)]">{order.userPhase}</dd></div>
        <div><dt>订单金额</dt><dd className="m-0 font-mono text-2xl font-semibold text-[var(--ink)]">{money(order.totalAmountCents)}</dd></div>
        <div><dt>锁定截止</dt><dd className="m-0 font-semibold text-[var(--ink)]">{new Date(order.holdExpiresAt).toLocaleString("zh-CN")}</dd></div>
      </dl>
      <Link className="button button-primary mt-6 min-h-12 w-full justify-center sm:w-auto" href={`/buyer/orders/${encodeURIComponent(order.id)}`}>查看订单并继续</Link>
    </section>
  );

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section aria-labelledby="checkout-title">
        <p className="kicker">{vocabulary.marketLabel}</p>
        <h1 id="checkout-title" className="m-0 text-4xl sm:text-5xl">锁定数量与服务时间</h1>
        <p className="section-lead">这一步只预留容量并提交供应商确认，不会扣款。</p>
        {error ? <div role="alert" className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]"><p className="m-0">{error}</p>{idempotencyConflict ? <button className="button button-secondary mt-4" type="button" onClick={() => { keyRef.current = null; setIdempotencyConflict(false); setError(""); }}>开始新的下单尝试</button> : null}</div> : null}
        <div className="form-grid mt-8">
          <label className="field">
            <span>{vocabulary.rateFieldLabel}{rateInputHint(listing.productCode)}</span>
            <input type="number" min={displayedRateUnits(listing.productCode, listing.minRateUnits)} max={displayedRateUnits(listing.productCode, listing.maxRateUnits)} step={listing.productCode === "TOKEN_THROUGHPUT" ? 0.001 : 1} value={displayedRateUnits(listing.productCode, rateUnits)} onChange={(event) => setRateUnits(canonicalRateUnits(listing.productCode, event.target.value))} />
          </label>
          <div className="field">
            <span>本报价可购范围</span>
            <strong className="flex min-h-12 items-center border border-[var(--border)] bg-[var(--info-bg)] px-4 text-[var(--ink)]">{formatRateUnits(listing.productCode, listing.minRateUnits)}–{formatRateUnits(listing.productCode, listing.maxRateUnits)}</strong>
          </div>
          <label className="field"><span>服务开始</span><input type="datetime-local" step="1" min={inputDate(listing.lot.startAt)} max={inputDate(listing.lot.endAt)} value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
          <label className="field"><span>服务结束</span><input type="datetime-local" step="1" min={inputDate(listing.lot.startAt)} max={inputDate(listing.lot.endAt)} value={endAt} onChange={(event) => setEndAt(event.target.value)} /></label>
        </div>
        <button className="button button-primary mt-7 min-h-12 w-full justify-center sm:w-auto" type="button" disabled={busy || !estimate} onClick={() => void submit()}>{busy ? "正在校验并锁定…" : "锁定容量，等待供应商确认"}</button>
      </section>
      <aside className="self-start border-t-4 border-[var(--accent)] bg-[var(--info-bg)] p-6 lg:sticky lg:top-28">
        <p className="m-0 text-sm font-semibold text-[var(--accent)]">{listing.resource.region} · {listing.deliveryForm}</p>
        <h2 className="mt-2 text-2xl">{listing.product.displayName}</h2>
        <p>{listing.scopeNote}</p>
        <dl className="mt-5 grid gap-4 border-y border-[var(--border)] py-5">
          <div><dt>中断属性</dt><dd className="m-0 font-semibold text-[var(--ink)]">{listing.resource.interruptibility === "NON_INTERRUPTIBLE" ? "不可中断" : "可中断"}</dd></div>
          <div><dt>单价</dt><dd className="m-0 font-mono text-xl font-semibold text-[var(--ink)]">{formatUnitPrice(listing.productCode, listing.unitPriceMicros)}</dd></div>
          {formatStandardMonthComparison(listing.productCode, listing.unitPriceMicros) ? <div><dt>柜月比较</dt><dd className="m-0 font-semibold text-[var(--ink)]">{formatStandardMonthComparison(listing.productCode, listing.unitPriceMicros)}</dd></div> : null}
          <div><dt>预计容量</dt><dd className="m-0 text-lg font-semibold text-[var(--ink)]">{estimate ? formatCapacityHours(listing.productCode, estimate.capacityBaseUnits) : "—"}</dd></div>
          <div><dt>预计订单金额</dt><dd className="m-0 font-mono text-3xl font-semibold text-[var(--ink)]">{estimate ? money(estimate.amountCents) : "—"}</dd></div>
        </dl>
        <p className="text-sm">最终金额由服务端按这个不可变报价版本、所选数量与精确服务时间重新计算。</p>
      </aside>
    </div>
  );
}
