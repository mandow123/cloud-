"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarketListing, SwapQuote, SwapQuoteStatus } from "@/lib/exchange";
import { capacityDisplay, formatCapacityHours, formatRateUnits, formatUnitPrice } from "@/lib/capacity-display";
import {
  createIdempotencyKey,
  exchangeGet,
  exchangePost,
  MarketplaceApiError,
  marketplaceErrorMessage,
} from "@/lib/client/marketplace-client";

type SwapOptions = { view: "options"; offered: MarketListing[]; wanted: MarketListing[] };
type SwapQuotePage = { view: "mine"; items: SwapQuote[]; count: number };
type LegDraft = { listingVersionId: string; rateUnits: string; startAt: string; endAt: string };

const emptyLeg: LegDraft = { listingVersionId: "", rateUnits: "", startAt: "", endAt: "" };

const quoteStatusLabel: Record<SwapQuoteStatus, string> = {
  QUOTED: "报价有效",
  OPS_REVIEW: "已提交人工复核",
  CANCELLED: "已取消",
  EXPIRED: "已过期",
};

function localDateTime(iso: string) {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1_000);
  return local.toISOString().slice(0, 19);
}

function displayedRate(listing: MarketListing, value: number) {
  if (listing.productCode === "TOKEN_THROUGHPUT") return value / 1_000;
  if (listing.productCode === "NAS_STORAGE") return value / 1_024;
  return value;
}

function canonicalRate(listing: MarketListing, value: string) {
  const input = Number(value);
  const scaled = listing.productCode === "TOKEN_THROUGHPUT"
    ? input * 1_000
    : listing.productCode === "NAS_STORAGE"
      ? input * 1_024
      : input;
  return Number.isSafeInteger(scaled) && scaled > 0 ? scaled : 0;
}

function rateStep(listing: MarketListing | undefined) {
  return listing?.productCode === "TOKEN_THROUGHPUT" ? "0.001" : "1";
}

function draftFor(listing: MarketListing): LegDraft {
  const earliestStart = Math.max(Date.parse(listing.lot.startAt), Math.ceil((Date.now() + 120_000) / 1_000) * 1_000);
  return {
    listingVersionId: listing.id,
    rateUnits: String(displayedRate(listing, listing.minRateUnits)),
    startAt: localDateTime(new Date(earliestStart).toISOString()),
    endAt: localDateTime(listing.lot.endAt),
  };
}

function listingLabel(listing: MarketListing) {
  return `${listing.product.displayName} · ${listing.resource.region} · ${formatUnitPrice(listing.productCode, listing.unitPriceMicros)}`;
}

function money(cents: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
}

function adjustmentText(quote: SwapQuote) {
  if (quote.cashAdjustmentSignedCents > 0) return `发起方需补给对方 ${money(quote.cashAdjustmentAmountCents)}`;
  if (quote.cashAdjustmentSignedCents < 0) return `对方需补给发起方 ${money(quote.cashAdjustmentAmountCents)}`;
  return "两腿估值相同，无补差";
}

function LegFields({
  legend,
  listings,
  draft,
  onChange,
}: {
  legend: string;
  listings: MarketListing[];
  draft: LegDraft;
  onChange: (next: LegDraft) => void;
}) {
  const listing = listings.find((item) => item.id === draft.listingVersionId);
  return (
    <fieldset className="m-0 border border-[var(--border)] p-5 sm:p-6">
      <legend className="px-2 text-xl font-semibold text-[var(--ink)]">{legend}</legend>
      <div className="form-grid mt-2">
        <label className="field full-span">
          <span>在售挂牌</span>
          <select required value={draft.listingVersionId} onChange={(event) => {
            const next = listings.find((item) => item.id === event.target.value);
            onChange(next ? draftFor(next) : emptyLeg);
          }}>
            <option value="">请选择</option>
            {listings.map((item) => <option key={item.id} value={item.id}>{listingLabel(item)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{listing ? capacityDisplay(listing.productCode).rateFieldLabel : "交付数量"}</span>
          <input
            disabled={!listing}
            max={listing ? displayedRate(listing, listing.maxRateUnits) : undefined}
            min={listing ? displayedRate(listing, listing.minRateUnits) : undefined}
            onChange={(event) => onChange({ ...draft, rateUnits: event.target.value })}
            required
            step={rateStep(listing)}
            type="number"
            value={draft.rateUnits}
          />
          {listing ? <small>可选 {formatRateUnits(listing.productCode, listing.minRateUnits)}–{formatRateUnits(listing.productCode, listing.maxRateUnits)}</small> : null}
        </label>
        <div className="field">
          <span>挂牌单价</span>
          <strong className="flex min-h-12 items-center border border-[var(--border)] bg-[var(--info-bg)] px-4 text-[var(--ink)]">{listing ? formatUnitPrice(listing.productCode, listing.unitPriceMicros) : "—"}</strong>
        </div>
        <label className="field">
          <span>服务开始</span>
          <input disabled={!listing} min={listing ? localDateTime(listing.lot.startAt) : undefined} max={listing ? localDateTime(listing.lot.endAt) : undefined} onChange={(event) => onChange({ ...draft, startAt: event.target.value })} required step="1" type="datetime-local" value={draft.startAt} />
        </label>
        <label className="field">
          <span>服务结束</span>
          <input disabled={!listing} min={listing ? localDateTime(listing.lot.startAt) : undefined} max={listing ? localDateTime(listing.lot.endAt) : undefined} onChange={(event) => onChange({ ...draft, endAt: event.target.value })} required step="1" type="datetime-local" value={draft.endAt} />
        </label>
      </div>
    </fieldset>
  );
}

export function SupplierSwapWorkspace({ initialWantedListingId = "" }: { initialWantedListingId?: string }) {
  const [offeredOptions, setOfferedOptions] = useState<MarketListing[]>([]);
  const [wantedOptions, setWantedOptions] = useState<MarketListing[]>([]);
  const [quotes, setQuotes] = useState<SwapQuote[]>([]);
  const [offered, setOffered] = useState<LegDraft>(emptyLeg);
  const [wanted, setWanted] = useState<LegDraft>(emptyLeg);
  const [latest, setLatest] = useState<SwapQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"create" | string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const createKey = useRef<string | null>(null);
  const transitionKeys = useRef(new Map<string, string>());

  const loadQuotes = useCallback(async () => {
    const page = await exchangeGet<SwapQuotePage>("/api/v1/swap-quotes?view=mine", "supplier");
    setQuotes(page.items);
  }, []);

  useEffect(() => {
    Promise.all([
      exchangeGet<SwapOptions>("/api/v1/swap-quotes?view=options", "supplier"),
      exchangeGet<SwapQuotePage>("/api/v1/swap-quotes?view=mine", "supplier"),
    ]).then(([options, page]) => {
      setOfferedOptions(options.offered);
      setWantedOptions(options.wanted);
      setQuotes(page.items);
      if (options.offered[0]) setOffered(draftFor(options.offered[0]));
      const preferred = options.wanted.find((item) => item.id === initialWantedListingId) ?? options.wanted[0];
      if (preferred) setWanted(draftFor(preferred));
    }).catch((loadError) => {
      setError(marketplaceErrorMessage(loadError, "置换报价工作台暂时无法加载。"));
    }).finally(() => setLoading(false));
  }, [initialWantedListingId]);

  const selectedOffered = useMemo(() => offeredOptions.find((item) => item.id === offered.listingVersionId), [offeredOptions, offered.listingVersionId]);
  const selectedWanted = useMemo(() => wantedOptions.find((item) => item.id === wanted.listingVersionId), [wantedOptions, wanted.listingVersionId]);

  async function submitQuote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOffered || !selectedWanted) return;
    const offeredRateUnits = canonicalRate(selectedOffered, offered.rateUnits);
    const wantedRateUnits = canonicalRate(selectedWanted, wanted.rateUnits);
    if (!offeredRateUnits || !wantedRateUnits) {
      setError("两条置换腿都必须填写符合产品最小精度的数量。");
      return;
    }
    setBusy("create");
    setError("");
    setNotice("");
    try {
      createKey.current ??= createIdempotencyKey("swap-quote");
      const result = await exchangePost<SwapQuote>("/api/v1/swap-quotes", "supplier", {
        offered: {
          listingVersionId: selectedOffered.id,
          rateUnits: offeredRateUnits,
          startAt: new Date(offered.startAt).toISOString(),
          endAt: new Date(offered.endAt).toISOString(),
        },
        wanted: {
          listingVersionId: selectedWanted.id,
          rateUnits: wantedRateUnits,
          startAt: new Date(wanted.startAt).toISOString(),
          endAt: new Date(wanted.endAt).toISOString(),
        },
      }, createKey.current);
      createKey.current = null;
      setLatest(result.record);
      setNotice("15 分钟置换报价已生成；库存仍未锁定，也没有发起补差支付。");
      await loadQuotes();
    } catch (submitError) {
      setError(marketplaceErrorMessage(submitError, "置换报价生成失败，请检查两条挂牌的数量和服务时间。"));
    } finally {
      setBusy(null);
    }
  }

  async function transition(quote: SwapQuote, action: "OPS_REVIEW" | "CANCELLED" | "EXPIRED") {
    const operation = `${quote.id}:${action}`;
    setBusy(operation);
    setError("");
    setNotice("");
    try {
      const key = transitionKeys.current.get(operation) ?? createIdempotencyKey("swap-status");
      transitionKeys.current.set(operation, key);
      const reason = action === "OPS_REVIEW"
        ? "提交 KAI 运营人工复核。"
        : action === "CANCELLED"
          ? "发起方取消本次置换报价。"
          : "报价已到服务端有效期。";
      const result = await exchangePost<SwapQuote>(`/api/v1/swap-quotes/${encodeURIComponent(quote.id)}/status-events`, "supplier", {
        expectedVersion: quote.version,
        action,
        reason,
      }, key);
      transitionKeys.current.delete(operation);
      setLatest((current) => current?.id === quote.id ? result.record : current);
      setNotice(action === "OPS_REVIEW" ? "已提交人工复核，仍未锁定库存。" : action === "CANCELLED" ? "报价已取消。" : "报价已标记过期。");
      await loadQuotes();
    } catch (transitionError) {
      if (transitionError instanceof MarketplaceApiError && transitionError.status === 409) {
        transitionKeys.current.delete(operation);
        await loadQuotes();
      }
      setError(marketplaceErrorMessage(transitionError, "报价状态更新失败，请刷新后重试。"));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="border-l-2 border-[var(--accent)] pl-4">正在读取在售挂牌与置换报价…</p>;

  return (
    <div className="grid gap-12">
      {error ? <div className="border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">{error}</div> : null}
      {notice ? <div className="border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4 text-[var(--ink)]" role="status">{notice}</div> : null}

      <section aria-labelledby="swap-builder-title">
        <div className="border-l-4 border-[var(--accent)] bg-[var(--info-bg)] p-5" role="note">
          <strong className="block text-[var(--ink)]">15 分钟价值快照</strong>
          <span className="mt-1 block">这是按当前在售报价生成的价值快照，不锁库存，不构成成交，也不会发起补差支付。</span>
        </div>
        <h2 className="mt-8 text-3xl" id="swap-builder-title">选择两条在售容量</h2>
        {offeredOptions.length === 0 || wantedOptions.length === 0 ? (
          <p className="bg-[var(--warning-bg)] p-5 text-[var(--warning)]">精确置换需要“我的有效挂牌”和“另一家供应商的有效挂牌”。当前选项不足，可先上架容量或使用人工撮合置换需求。</p>
        ) : (
          <form className="mt-7 grid gap-6" onSubmit={submitQuote}>
            <LegFields draft={offered} legend="我可提供的在售容量" listings={offeredOptions} onChange={setOffered} />
            <LegFields draft={wanted} legend="我希望换入的在售容量" listings={wantedOptions} onChange={setWanted} />
            <div><button className="button button-primary w-full sm:w-auto" disabled={busy !== null} type="submit">{busy === "create" ? "正在计算并固化快照…" : "生成 15 分钟置换报价"}</button></div>
          </form>
        )}
      </section>

      {latest ? (
        <section aria-labelledby="latest-swap-title" className="border-t-4 border-[var(--accent)] bg-[var(--info-bg)] p-6 sm:p-8">
          <p className="kicker">服务端报价结果</p>
          <h2 className="m-0 text-3xl" id="latest-swap-title">{adjustmentText(latest)}</h2>
          <dl className="mt-6 grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-[var(--surface)] p-4"><dt>提供腿价值</dt><dd className="m-0 text-xl font-semibold text-[var(--ink)]">{money(latest.offeredValueCents)}</dd></div>
            <div className="bg-[var(--surface)] p-4"><dt>换入腿价值</dt><dd className="m-0 text-xl font-semibold text-[var(--ink)]">{money(latest.wantedValueCents)}</dd></div>
            <div className="bg-[var(--surface)] p-4"><dt>当前状态</dt><dd className="m-0 font-semibold text-[var(--ink)]">{quoteStatusLabel[latest.status]}</dd></div>
            <div className="bg-[var(--surface)] p-4"><dt>有效至</dt><dd className="m-0 font-semibold text-[var(--ink)]">{new Date(latest.expiresAt).toLocaleString("zh-CN")}</dd></div>
          </dl>
          <p className="mb-0 mt-5 text-sm">提供：{formatRateUnits(latest.offered.productCode, latest.offered.rateUnits)} · {formatCapacityHours(latest.offered.productCode, latest.offered.capacityBaseUnits)}；换入：{formatRateUnits(latest.wanted.productCode, latest.wanted.rateUnits)} · {formatCapacityHours(latest.wanted.productCode, latest.wanted.capacityBaseUnits)}。</p>
        </section>
      ) : null}

      <section aria-labelledby="swap-history-title" className="border-t border-[var(--border)] pt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="kicker">报价记录</p><h2 className="m-0 text-3xl" id="swap-history-title">与我有关的置换报价</h2></div>
          <button className="button button-secondary" disabled={busy !== null} onClick={() => void loadQuotes()} type="button">刷新状态</button>
        </div>
        {quotes.length === 0 ? <p className="mt-6 bg-[var(--info-bg)] p-5">尚未生成置换报价。</p> : (
          <ul className="mt-7 grid gap-px bg-[var(--border)] p-0">
            {quotes.map((quote) => (
              <li className="list-none bg-[var(--surface)] p-5 sm:p-6" key={quote.id}>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                  <div className="min-w-0">
                    <span className="font-mono text-sm text-[var(--muted)] break-all">{quote.id}</span>
                    <strong className="mt-2 block text-xl text-[var(--ink)]">{adjustmentText(quote)}</strong>
                    <span className="mt-2 block text-sm">{quoteStatusLabel[quote.status]} · 生成于 {new Date(quote.generatedAt).toLocaleString("zh-CN")} · 有效至 {new Date(quote.expiresAt).toLocaleString("zh-CN")}</span>
                  </div>
                  {quote.allowedActions.length ? (
                    <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
                      {quote.allowedActions.includes("OPS_REVIEW") ? <button className="button button-secondary" disabled={busy !== null} onClick={() => void transition(quote, "OPS_REVIEW")} type="button">提交人工复核</button> : null}
                      {quote.allowedActions.includes("CANCELLED") ? <button className="button button-secondary" disabled={busy !== null} onClick={() => void transition(quote, "CANCELLED")} type="button">取消报价</button> : null}
                      {quote.allowedActions.includes("EXPIRED") ? <button className="button button-secondary" disabled={busy !== null} onClick={() => void transition(quote, "EXPIRED")} type="button">确认已过期</button> : null}
                    </div>
                  ) : null}
                </div>
                {quote.status === "OPS_REVIEW" ? <p className="mb-0 mt-4 border-l-2 border-[var(--accent)] pl-4 text-sm">已提交人工复核，仍未锁定库存。</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
