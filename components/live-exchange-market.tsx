"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MarketListing } from "@/lib/exchange";
import { exchangeGet, marketplaceErrorMessage } from "@/lib/client/marketplace-client";
import { capacityDisplay, formatCapacityHours, formatRateUnits, formatStandardMonthComparison, formatUnitPrice } from "@/lib/capacity-display";

type ListingPage = { items: MarketListing[]; count: number; updatedAt: string };

export function LiveExchangeMarket() {
  const [page, setPage] = useState<ListingPage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    exchangeGet<ListingPage>("/api/v1/market/listings", "buyer")
      .then(setPage)
      .catch((loadError) => setError(marketplaceErrorMessage(loadError, "可交易资源暂时无法加载。")));
  }, []);

  return (
    <section aria-labelledby="live-listings-title" className="border-b border-[var(--border)] bg-[var(--info-bg)]">
      <div className="shell py-12 sm:py-16">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="kicker">在售容量</p>
            <h1 id="live-listings-title" className="m-0 text-4xl sm:text-5xl">选择资源，锁定连续服务时间</h1>
            <p className="section-lead max-w-4xl">这里仅列出已核验、报价仍有效且容量时间窗连续的资源。提交订单时，平台同时锁定数量和时间。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link className="button button-secondary" href="/buyer/orders">我的采购订单</Link>
            <Link className="button button-secondary" href="/supplier">上架可售容量</Link>
          </div>
        </div>
        {error ? <div role="alert" className="mt-7 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]">{error}</div> : null}
        {!page && !error ? <p className="mt-7 border-l-2 border-[var(--accent)] pl-4">正在核对可售时间窗…</p> : null}
        {page && page.items.length === 0 ? <p className="mt-7 border-y border-[var(--border)] bg-[var(--surface)] p-6">当前没有可直接锁定的容量。你仍可浏览下方行情并提交算力需求。</p> : null}
        {page?.items.length ? (
          <div className="mt-8 grid gap-px bg-[var(--border)] lg:grid-cols-2">
            {page.items.map((listing) => {
              const vocabulary = capacityDisplay(listing.productCode);
              const serviceScope = [
                listing.taxIncluded ? "含税" : "未含税",
                listing.energyIncluded ? "含电" : "未含电",
                listing.networkIncluded ? "含网络" : "未含网络",
              ].join(" · ");
              return (
                <article key={listing.id} className="bg-[var(--surface)] p-6 sm:p-8">
                  <div className="flex flex-wrap items-start justify-between gap-5">
                    <div>
                      <p className="m-0 text-sm font-semibold text-[var(--accent)]">{vocabulary.marketLabel} · {listing.resource.region}</p>
                      <h2 className="mt-2 text-2xl">{listing.product.displayName}</h2>
                      <p className="m-0 text-sm">{listing.product.formFactor} · {listing.deliveryForm}</p>
                    </div>
                    <div className="text-left sm:text-right">
                      <strong className="block font-mono text-[clamp(1.75rem,4vw,2.25rem)] leading-none text-[var(--ink)]">{formatUnitPrice(listing.productCode, listing.unitPriceMicros)}</strong>
                      {formatStandardMonthComparison(listing.productCode, listing.unitPriceMicros) ? <span className="mt-2 block text-sm text-[var(--muted)]">{formatStandardMonthComparison(listing.productCode, listing.unitPriceMicros)}</span> : null}
                    </div>
                  </div>
                  <dl className="mt-6 grid gap-x-6 gap-y-4 border-y border-[var(--border)] py-5 text-sm sm:grid-cols-2">
                    <div><dt>可售时间</dt><dd className="m-0 font-semibold text-[var(--ink)]">{new Date(listing.lot.startAt).toLocaleString("zh-CN")} 至 {new Date(listing.lot.endAt).toLocaleString("zh-CN")}</dd></div>
                    <div><dt>批次总容量</dt><dd className="m-0 font-semibold text-[var(--ink)]">{formatRateUnits(listing.productCode, listing.lot.rateUnits)} · {formatCapacityHours(listing.productCode, listing.lot.capacityBaseUnits)}</dd></div>
                    <div><dt>{vocabulary.rateFieldLabel}</dt><dd className="m-0 font-semibold text-[var(--ink)]">{formatRateUnits(listing.productCode, listing.minRateUnits)}–{formatRateUnits(listing.productCode, listing.maxRateUnits)}</dd></div>
                    <div><dt>报价包含</dt><dd className="m-0 font-semibold text-[var(--ink)]">{serviceScope}</dd></div>
                  </dl>
                  <p className="mt-5">{listing.scopeNote}</p>
                  <p className="mt-5 text-sm text-[var(--muted)]">购买会在订单提交时锁定数量和时间；置换报价只生成 15 分钟价值快照，不锁库存。</p>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <Link className="button button-primary min-h-12 w-full justify-center sm:w-auto" href={`/checkout/${encodeURIComponent(listing.id)}`}>{vocabulary.purchaseAction}</Link>
                    <Link className="button button-secondary min-h-12 w-full justify-center sm:w-auto" href={`/supplier/swap-quotes?wanted=${encodeURIComponent(listing.id)}`}>供应商：用于置换报价</Link>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
