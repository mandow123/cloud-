"use client";

import { useMemo, useState } from "react";

export type ModelMarketScope = "domestic" | "international";
export type ModelCapability = "text" | "reasoning" | "multimodal" | "embedding";
export type ModelPriceSourceStatus =
  | "official_api"
  | "official_page"
  | "aggregated"
  | "provider_quote"
  | "estimated";

export interface ModelTokenPriceQuote {
  id: string;
  vendor: string;
  model: string;
  market: ModelMarketScope;
  categories: readonly ModelCapability[];
  inputCnyPerMillion: number | null;
  cachedInputCnyPerMillion: number | null;
  outputCnyPerMillion: number | null;
  originalCurrency: string;
  originalInputPerMillion?: number | null;
  originalCachedInputPerMillion?: number | null;
  originalOutputPerMillion?: number | null;
  sourceName: string;
  sourceUrl?: string;
  officialSourceName?: string;
  officialSourceUrl?: string;
  sourceStatus: ModelPriceSourceStatus;
  updatedAt: string;
  isStale: boolean;
  freshness?: {
    state?: "current" | "official_only" | "stale" | "review_required";
  };
  availabilityNote?: string;
}

export interface ModelCostIndexSnapshot {
  name?: string;
  value: number;
  baseDate: string;
  updatedAt: string;
  change1d?: number;
  change30d?: number;
  sampleSize?: number;
}

export interface ModelPriceBoardProps {
  quotes: readonly ModelTokenPriceQuote[];
  index: ModelCostIndexSnapshot;
  className?: string;
}

type MarketFilter = "all" | ModelMarketScope;
type CapabilityFilter = "all" | ModelCapability;
type FreshnessFilter = "all" | "fresh" | "stale";

const MARKET_LABELS: Record<ModelMarketScope, string> = {
  domestic: "国内",
  international: "国际",
};

const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  text: "文本",
  reasoning: "推理",
  multimodal: "多模态",
  embedding: "嵌入",
};

const SOURCE_LABELS: Record<ModelPriceSourceStatus, string> = {
  official_api: "官方 API",
  official_page: "官方页面",
  aggregated: "聚合目录·待官方复核",
  provider_quote: "供应方报盘",
  estimated: "KAI 估算",
};

const SOURCE_STYLES: Record<ModelPriceSourceStatus, string> = {
  official_api: "border-[var(--border-strong)] bg-[var(--success-bg)] text-[var(--success)]",
  official_page: "border-[var(--border-strong)] bg-[var(--accent-soft)] text-[var(--accent)]",
  aggregated: "border-[var(--border-strong)] bg-[var(--warning-bg)] text-[var(--warning)]",
  provider_quote: "border-[var(--border-strong)] bg-[var(--warning-bg)] text-[var(--warning)]",
  estimated: "border-[var(--border)] bg-[var(--info-bg)] text-[var(--muted)]",
};

const fieldClass =
  "min-h-11 w-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)]";

function formatCnyPrice(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: value < 1 ? 3 : value < 100 ? 2 : 0,
    maximumFractionDigits: value < 1 ? 4 : value < 100 ? 2 : 0,
  }).format(value);
}

function formatOriginalPrice(value: number | null | undefined, currency: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      currencyDisplay: "code",
      minimumFractionDigits: value < 1 ? 3 : 2,
      maximumFractionDigits: value < 1 ? 4 : 2,
    }).format(value);
  } catch {
    return `${currency} ${formatCnyPrice(value)}`;
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function formatIndexChange(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "暂无";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function priceStatusLabel(value: number | null) {
  return value === null ? "未公布或不适用" : "人民币标准化价格";
}

function SourceBadge({ status }: { status: ModelPriceSourceStatus }) {
  return (
    <span
      className={`inline-flex min-h-7 items-center border px-2 py-1 text-[11px] font-semibold ${SOURCE_STYLES[status]}`}
    >
      {SOURCE_LABELS[status]}
    </span>
  );
}

function FreshnessBadge({ quote }: { quote: ModelTokenPriceQuote }) {
  if (quote.freshness?.state === "official_only") {
    return (
      <span className="inline-flex min-h-7 items-center border border-[var(--border)] bg-[var(--info-bg)] px-2 py-1 text-[11px] font-semibold text-[var(--muted)]">
        官方审核基线
      </span>
    );
  }
  return quote.isStale ? (
    <span className="inline-flex min-h-7 items-center border border-[var(--border-strong)] bg-[var(--warning-bg)] px-2 py-1 text-[11px] font-semibold text-[var(--warning)]">
      需人工复核
    </span>
  ) : (
    <span className="inline-flex min-h-7 items-center border border-[var(--border)] bg-[var(--success-bg)] px-2 py-1 text-[11px] font-semibold text-[var(--success)]">
      已通过自动校验
    </span>
  );
}

function CapabilityTags({ categories }: { categories: readonly ModelCapability[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {categories.map((category) => (
        <span
          className="border border-[var(--border)] bg-[var(--info-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text)]"
          key={category}
        >
          {CAPABILITY_LABELS[category]}
        </span>
      ))}
    </span>
  );
}

function OriginalPriceLine({ quote }: { quote: ModelTokenPriceQuote }) {
  return (
    <span className="grid gap-1 text-xs tabular-nums text-[var(--muted)]">
      <span>输入 {formatOriginalPrice(quote.originalInputPerMillion, quote.originalCurrency)}</span>
      <span>缓存 {formatOriginalPrice(quote.originalCachedInputPerMillion, quote.originalCurrency)}</span>
      <span>输出 {formatOriginalPrice(quote.originalOutputPerMillion, quote.originalCurrency)}</span>
    </span>
  );
}

export function ModelPriceBoard({ quotes, index, className = "" }: ModelPriceBoardProps) {
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState<MarketFilter>("all");
  const [capability, setCapability] = useState<CapabilityFilter>("all");
  const [freshness, setFreshness] = useState<FreshnessFilter>("all");

  const filteredQuotes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return quotes.filter((quote) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        quote.vendor.toLocaleLowerCase("zh-CN").includes(normalizedQuery) ||
        quote.model.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
      const matchesMarket = market === "all" || quote.market === market;
      const matchesCapability = capability === "all" || quote.categories.includes(capability);
      const matchesFreshness =
        freshness === "all" ||
        (freshness === "stale" && quote.isStale) ||
        (freshness === "fresh" && !quote.isStale);
      return matchesQuery && matchesMarket && matchesCapability && matchesFreshness;
    });
  }, [capability, freshness, market, query, quotes]);

  const supplierCount = new Set(filteredQuotes.map((quote) => quote.vendor)).size;
  const modelCount = new Set(filteredQuotes.map((quote) => `${quote.vendor}\u0000${quote.model}`)).size;
  const staleCount = filteredQuotes.filter((quote) => quote.isStale).length;
  const hasFilters = query.length > 0 || market !== "all" || capability !== "all" || freshness !== "all";
  const indexDirection = (index.change30d ?? 0) > 0 ? "上涨" : (index.change30d ?? 0) < 0 ? "下降" : "持平";

  function clearFilters() {
    setQuery("");
    setMarket("all");
    setCapability("all");
    setFreshness("all");
  }

  return (
    <section className={className} aria-labelledby="model-price-board-title">
      <div className="grid border-y border-[var(--border)] bg-[var(--surface)] lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="p-5 sm:p-7">
          <p className="kicker">Model price intelligence</p>
          <h2 className="m-0 text-2xl leading-tight text-[var(--ink)] sm:text-3xl" id="model-price-board-title">
            主流模型 Token 分项行情
          </h2>
          <p className="mt-3 mb-0 max-w-3xl text-sm leading-6 text-[var(--text)]">
            每个模型按输入、缓存输入和输出分别报价，并保留原币种与来源状态。人民币价格统一为“元 / 百万 Token”，不可用字段以“—”表示。
          </p>
          <p className="mt-4 mb-0 inline-flex border border-[var(--border-strong)] bg-[var(--success-bg)] px-3 py-2 text-xs font-semibold text-[var(--success)]">
            每日 06:00（北京时间）更新 · 失败时保留上一版，不发布半表
          </p>
        </div>
        <aside className="border-t-2 border-[var(--accent)] bg-[var(--info-bg)] p-5 lg:border-t-0 lg:border-l lg:border-l-[var(--border)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="m-0 text-xs font-semibold text-[var(--muted)]">
                {index.name ?? "KAI 模型调用成本指数"}
              </p>
              <p className="mt-2 mb-0 text-3xl font-semibold tabular-nums text-[var(--ink)]">
                {index.value.toFixed(2)}
              </p>
            </div>
            <span className="border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-xs font-semibold text-[var(--accent)]">
              基期 100
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-[var(--border)] py-3 text-xs">
            <div>
              <dt className="text-[var(--muted)]">1 日变化</dt>
              <dd className="mt-1 font-semibold tabular-nums text-[var(--ink)]">{formatIndexChange(index.change1d)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">30 日变化</dt>
              <dd className="mt-1 font-semibold tabular-nums text-[var(--ink)]">{formatIndexChange(index.change30d)}</dd>
            </div>
          </dl>
          <p className="mt-3 mb-0 text-xs leading-5 text-[var(--muted)]">
            该指数仅表达固定模型篮子相对基期 100 的成本{indexDirection}趋势，不是跨模型人民币均价，也不能替代任一模型的实际报价。
          </p>
          <p className="mt-2 mb-0 text-[11px] text-[var(--muted)]">
            基期 {index.baseDate} · 更新 {formatDateTime(index.updatedAt)}
            {index.sampleSize !== undefined ? ` · 样本 ${index.sampleSize}` : ""}
          </p>
        </aside>
      </div>

      <div className="mt-6 border-y border-[var(--border)] bg-[var(--info-bg)] p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1.4fr)_repeat(3,minmax(150px,0.8fr))_auto] xl:items-end">
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--ink)]">
            搜索厂商或模型
            <input
              className={fieldClass}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：DeepSeek、Qwen、GPT"
              type="search"
              value={query}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--ink)]">
            市场范围
            <select className={fieldClass} onChange={(event) => setMarket(event.target.value as MarketFilter)} value={market}>
              <option value="all">国内与国际</option>
              <option value="domestic">国内</option>
              <option value="international">国际</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--ink)]">
            模型分类
            <select
              className={fieldClass}
              onChange={(event) => setCapability(event.target.value as CapabilityFilter)}
              value={capability}
            >
              <option value="all">全部分类</option>
              <option value="text">文本</option>
              <option value="reasoning">推理</option>
              <option value="multimodal">多模态</option>
              <option value="embedding">嵌入</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--ink)]">
            数据新鲜度
            <select className={fieldClass} onChange={(event) => setFreshness(event.target.value as FreshnessFilter)} value={freshness}>
              <option value="all">全部状态</option>
              <option value="fresh">已通过自动校验</option>
              <option value="stale">需人工复核</option>
            </select>
          </label>
          <button
            className="button button-secondary button-compact min-h-11 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!hasFilters}
            onClick={clearFilters}
            type="button"
          >
            清除筛选
          </button>
        </div>
        <p className="mt-4 mb-0 text-xs text-[var(--muted)]" aria-live="polite">
          显示 {filteredQuotes.length} 个价格档 · {modelCount} 个具体模型 · {supplierCount} 家厂商
          {staleCount > 0 ? ` · ${staleCount} 条触发人工复核` : " · 当前结果均已通过自动校验"}
        </p>
      </div>

      {filteredQuotes.length === 0 ? (
        <div className="mt-6 border-y border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
          <p className="m-0 text-lg font-semibold text-[var(--ink)]">没有匹配的模型行情</p>
          <p className="mt-2 mb-0 text-sm text-[var(--muted)]">可清除部分筛选，或检查厂商与模型名称。</p>
          <button className="button button-secondary mt-5" onClick={clearFilters} type="button">
            查看全部模型
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 hidden overflow-x-auto border border-[var(--border)] lg:block">
            <table className="data-table min-w-[1180px]">
              <caption className="sr-only">主流模型 Token 分项价格、原币种、数据来源和更新时间</caption>
              <thead>
                <tr>
                  <th scope="col">厂商 / 模型</th>
                  <th scope="col">范围 / 分类</th>
                  <th className="num" scope="col">输入<br />元 / 百万 Token</th>
                  <th className="num" scope="col">缓存输入<br />元 / 百万 Token</th>
                  <th className="num" scope="col">输出<br />元 / 百万 Token</th>
                  <th scope="col">原币种 / 百万 Token</th>
                  <th scope="col">来源 / 更新时间</th>
                </tr>
              </thead>
              <tbody>
                {filteredQuotes.map((quote) => (
                  <tr key={quote.id}>
                    <th className="min-w-56 text-left" scope="row">
                      <span className="block text-xs font-semibold text-[var(--accent)]">{quote.vendor}</span>
                      <span className="mt-1 block text-base text-[var(--ink)]">{quote.model}</span>
                      {quote.availabilityNote ? (
                        <span className="mt-1 block max-w-60 text-[11px] font-normal leading-4 text-[var(--muted)]">
                          {quote.availabilityNote}
                        </span>
                      ) : null}
                    </th>
                    <td className="min-w-44">
                      <span className="mb-2 block text-xs font-semibold text-[var(--ink)]">{MARKET_LABELS[quote.market]}</span>
                      <CapabilityTags categories={quote.categories} />
                    </td>
                    <PriceCell value={quote.inputCnyPerMillion} />
                    <PriceCell value={quote.cachedInputCnyPerMillion} />
                    <PriceCell value={quote.outputCnyPerMillion} />
                    <td className="min-w-52"><OriginalPriceLine quote={quote} /></td>
                    <td className="min-w-56">
                      <div className="flex flex-wrap gap-1.5">
                        <SourceBadge status={quote.sourceStatus} />
                        <FreshnessBadge quote={quote} />
                      </div>
                      <SourceName quote={quote} />
                      <span className="mt-1 block text-xs tabular-nums text-[var(--muted)]">
                        北京时间 {formatDateTime(quote.updatedAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid gap-4 lg:hidden">
            {filteredQuotes.map((quote) => (
              <article className="border-t-2 border-[var(--accent)] bg-[var(--surface)] p-5 ring-1 ring-[var(--border)]" key={quote.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="m-0 text-xs font-semibold text-[var(--accent)]">
                      {quote.vendor} · {MARKET_LABELS[quote.market]}
                    </p>
                    <h3 className="mt-1 mb-0 text-xl text-[var(--ink)]">{quote.model}</h3>
                  </div>
                  <FreshnessBadge quote={quote} />
                </div>
                <div className="mt-3"><CapabilityTags categories={quote.categories} /></div>
                <dl className="mt-5 grid grid-cols-3 border-y border-[var(--border)] text-center">
                  <MobilePrice label="输入" value={quote.inputCnyPerMillion} />
                  <MobilePrice label="缓存输入" value={quote.cachedInputCnyPerMillion} bordered />
                  <MobilePrice label="输出" value={quote.outputCnyPerMillion} />
                </dl>
                <p className="mt-2 mb-0 text-center text-[11px] text-[var(--muted)]">人民币元 / 百万 Token</p>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="m-0 text-xs font-semibold text-[var(--ink)]">原币种 / 百万 Token</p>
                    <div className="mt-2"><OriginalPriceLine quote={quote} /></div>
                  </div>
                  <div>
                    <p className="m-0 text-xs font-semibold text-[var(--ink)]">数据来源</p>
                    <div className="mt-2 flex flex-wrap gap-1.5"><SourceBadge status={quote.sourceStatus} /></div>
                    <SourceName quote={quote} />
                    <p className="mt-1 mb-0 text-xs tabular-nums text-[var(--muted)]">北京时间 {formatDateTime(quote.updatedAt)}</p>
                  </div>
                </div>
                {quote.availabilityNote ? (
                  <p className="mt-4 mb-0 border-t border-[var(--border)] pt-3 text-xs leading-5 text-[var(--muted)]">
                    {quote.availabilityNote}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function PriceCell({ value }: { value: number | null }) {
  return (
    <td className="num min-w-36">
      <span className="font-mono text-base font-semibold tabular-nums text-[var(--ink)]" title={priceStatusLabel(value)}>
        {formatCnyPrice(value)}
      </span>
    </td>
  );
}

function MobilePrice({ label, value, bordered = false }: { label: string; value: number | null; bordered?: boolean }) {
  return (
    <div className={`min-w-0 px-2 py-4 ${bordered ? "border-x border-[var(--border)]" : ""}`}>
      <dt className="text-[11px] text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 truncate font-mono text-sm font-semibold tabular-nums text-[var(--ink)]" title={priceStatusLabel(value)}>
        {formatCnyPrice(value)}
      </dd>
    </div>
  );
}

function SourceName({ quote }: { quote: ModelTokenPriceQuote }) {
  return (
    <span className="mt-2 grid max-w-56 gap-1 text-xs font-semibold">
      {quote.sourceUrl ? (
        <a
          className="truncate text-[var(--accent)] underline underline-offset-4"
          href={quote.sourceUrl}
          rel="noreferrer"
          target="_blank"
          title={quote.sourceName}
        >
          {quote.sourceName}
          <span className="sr-only">（在新窗口打开）</span>
        </a>
      ) : (
        <span className="truncate text-[var(--text)]" title={quote.sourceName}>{quote.sourceName}</span>
      )}
      {quote.sourceStatus === "aggregated" && quote.officialSourceUrl ? (
        <a
          className="truncate font-normal text-[var(--muted)] underline underline-offset-4"
          href={quote.officialSourceUrl}
          rel="noreferrer"
          target="_blank"
          title={quote.officialSourceName ?? "官方定价页"}
        >
          官方复核页：{quote.officialSourceName ?? "查看来源"}
          <span className="sr-only">（在新窗口打开）</span>
        </a>
      ) : null}
    </span>
  );
}
