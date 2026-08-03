"use client";

import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { formatPrice } from "@/lib/market";
import type { MarketSeries, ResourceCategory } from "@/lib/types";

const CATEGORY_ORDER: ResourceCategory[] = [
  "gpu",
  "rack_capacity",
  "cloud_vendor",
];

const CATEGORY_LABELS: Record<ResourceCategory, string> = {
  gpu: "GPU 算力",
  token_model: "Token / 模型",
  rack_capacity: "整机柜 / 容量",
  cloud_vendor: "云厂商资源",
};

type RangeDays = 7 | 30 | 90;

function isCategory(value: string | null): value is ResourceCategory {
  return CATEGORY_ORDER.includes(value as ResourceCategory);
}

function isRange(value: string | null): value is `${RangeDays}` {
  return value === "7" || value === "30" || value === "90";
}

function shortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function fullDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

export function MarketDashboard({
  series,
  modelBoard,
}: {
  series: readonly MarketSeries[];
  modelBoard?: ReactNode;
}) {
  const firstCategory = CATEGORY_ORDER.find((item) =>
    series.some((entry) => entry.category === item),
  ) ?? "gpu";
  const [category, setCategory] = useState<ResourceCategory>(firstCategory);
  const [range, setRange] = useState<RangeDays>(30);
  const [activeSeriesId, setActiveSeriesId] = useState("");

  const visibleSeries = useMemo(
    () => series.filter((entry) => entry.category === category),
    [category, series],
  );
  const activeSeries =
    visibleSeries.find((entry) => entry.id === activeSeriesId) ?? visibleSeries[0];
  const points = useMemo(
    () => activeSeries?.points.slice(-range) ?? [],
    [activeSeries, range],
  );

  useEffect(() => {
    function syncFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const nextCategory = params.get("category");
      const nextRange = params.get("range");
      const nextSeries = params.get("series");

      const resolvedCategory = isCategory(nextCategory) && series.some((entry) => entry.category === nextCategory)
        ? nextCategory
        : firstCategory;
      setCategory(resolvedCategory);
      setRange(isRange(nextRange) ? Number(nextRange) as RangeDays : 30);
      setActiveSeriesId(
        nextSeries && series.some((entry) => entry.id === nextSeries && entry.category === resolvedCategory)
          ? nextSeries
          : "",
      );
    }

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [firstCategory, series]);

  function writeUrl(next: {
    category?: ResourceCategory;
    range?: RangeDays;
    seriesId?: string;
  }) {
    const params = new URLSearchParams(window.location.search);
    if (next.category) params.set("category", next.category);
    if (next.range) params.set("range", String(next.range));
    if (next.seriesId) params.set("series", next.seriesId);
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  function chooseCategory(nextCategory: ResourceCategory) {
    const nextSeries = series.find((entry) => entry.category === nextCategory);
    setCategory(nextCategory);
    setActiveSeriesId(nextSeries?.id ?? "");
    writeUrl({ category: nextCategory, seriesId: nextSeries?.id });
  }

  function chooseRange(nextRange: RangeDays) {
    setRange(nextRange);
    writeUrl({ range: nextRange });
  }

  function moveCategory(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? CATEGORY_ORDER.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + CATEGORY_ORDER.length) % CATEGORY_ORDER.length;
    const nextCategory = CATEGORY_ORDER[nextIndex];
    chooseCategory(nextCategory);
    document.getElementById(`market-tab-${nextCategory}`)?.focus();
  }

  if (!activeSeries || points.length === 0) {
    return (
      <div className="border-y border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
        <p className="m-0 text-lg font-semibold text-[var(--ink)]">暂无该分类行情样本</p>
        <p className="mt-2 text-sm text-[var(--muted)]">请选择其他资源分类查看市场行情。</p>
      </div>
    );
  }

  const latest = points[points.length - 1];
  const baseline = points[0];
  const change = baseline.p50 === 0 ? 0 : ((latest.p50 - baseline.p50) / baseline.p50) * 100;
  const allValues = points.flatMap((point) => [point.p25, point.p50, point.p75]);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const chartSpan = Math.max(maxValue - minValue, 1);
  const averageSamples = Math.round(
    points.reduce((total, point) => total + point.sampleCount, 0) / points.length,
  );
  const direction = change > 0.05 ? "上涨" : change < -0.05 ? "下降" : "基本持平";

  return (
    <div>
      <section className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="shell py-14 sm:py-16">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
            <div>
              <p className="kicker">KAI Market Intelligence</p>
              <h1 className="m-0 max-w-4xl text-4xl leading-[1.08] text-[var(--ink)] sm:text-5xl">
                中国算力行情中心
              </h1>
              <p className="section-lead">
                将异构 GPU、Token、模型实例、机柜容量与云厂商资源，归一到可比较的价格分位和清晰计价口径。
              </p>
            </div>
            <dl className="m-0 grid grid-cols-2 border-t-2 border-[var(--accent)] bg-[var(--info-bg)]">
              <div className="border-b border-r border-[var(--border)] p-4">
                <dt className="text-xs font-semibold text-[var(--muted)]">覆盖分类</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--ink)]">4</dd>
              </div>
              <div className="border-b border-[var(--border)] p-4">
                <dt className="text-xs font-semibold text-[var(--muted)]">观察窗口</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--ink)]">90 天</dd>
              </div>
              <div className="border-r border-[var(--border)] p-4">
                <dt className="text-xs font-semibold text-[var(--muted)]">数据口径</dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">P25 / P50 / P75</dd>
              </div>
              <div className="p-4">
                <dt className="text-xs font-semibold text-[var(--muted)]">数据性质</dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--accent)]">日度目录价 + 初始化样本</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <div className="shell py-10 sm:py-12">
        <aside className="market-notice mb-8" aria-label="数据提示">
          <p className="m-0">
            <strong>分区数据说明：</strong>Token / 模型板块展示公开目录价与来源状态；GPU、机柜和云厂商行情使用平台初始化样本，供应商接入后核验更新。
          </p>
          <p className="m-0 whitespace-nowrap font-semibold text-[var(--warning)]">市场参考报价 · 具体以询价确认为准</p>
        </aside>

        {modelBoard ? (
          <div className="mb-14 scroll-mt-24" id="model-token-market">
            {modelBoard}
          </div>
        ) : null}

        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker">Infrastructure market</p>
            <h2 className="m-0 text-2xl text-[var(--ink)]">基础设施算力行情</h2>
          </div>
          <a className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent)] underline underline-offset-4" href="#model-token-market">
            查看 Token / 模型日度行情
          </a>
        </div>

        <div
          className="grid grid-cols-1 border-b border-[var(--border-strong)] sm:grid-cols-3"
          role="tablist"
          aria-label="行情资源分类"
        >
          {CATEGORY_ORDER.map((item, index) => {
            const selected = category === item;
            return (
              <button
                key={item}
                className={`min-h-12 cursor-pointer border-t-2 px-3 py-3 text-sm font-semibold transition-colors md:px-5 ${
                  selected
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                    : "border-transparent bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--info-bg)]"
                }`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="market-infrastructure-panel"
                id={`market-tab-${item}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => chooseCategory(item)}
                onKeyDown={(event) => moveCategory(event, index)}
              >
                {CATEGORY_LABELS[item]}
              </button>
            );
          })}
        </div>

        <section
          className="mt-6 border border-[var(--border)] bg-[var(--surface)]"
          role="tabpanel"
          aria-labelledby={`market-tab-${category}`}
          id="market-infrastructure-panel"
        >
          <div className="grid border-b border-[var(--border)] lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="p-5 sm:p-6">
              <label className="block max-w-lg text-xs font-semibold text-[var(--muted)]" htmlFor="series-select">
                观察基准
              </label>
              <select
                id="series-select"
                className="mt-2 min-h-11 w-full border border-[var(--border-strong)] bg-[var(--canvas)] px-3 text-sm font-semibold text-[var(--ink)] sm:w-auto sm:min-w-80"
                value={activeSeries.id}
                onChange={(event) => {
                  setActiveSeriesId(event.target.value);
                  writeUrl({ seriesId: event.target.value });
                }}
              >
                {visibleSeries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label} · {entry.region}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1 border-t border-[var(--border)] p-3 lg:border-t-0 lg:border-l">
              <span className="mr-2 text-xs font-semibold text-[var(--muted)]">观察区间</span>
              {([7, 30, 90] as RangeDays[]).map((days) => (
                <button
                  key={days}
                  type="button"
                  className={`min-h-11 min-w-14 cursor-pointer border px-3 text-sm font-semibold ${
                    range === days
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--border-strong)]"
                  }`}
                  aria-pressed={range === days}
                  onClick={() => chooseRange(days)}
                >
                  {days} 天
                </button>
              ))}
            </div>
          </div>

          <div className="grid xl:grid-cols-[300px_minmax(0,1fr)]">
            <div className="border-b border-[var(--border)] p-5 sm:p-6 xl:border-r xl:border-b-0">
              <p className="m-0 text-xs font-semibold tracking-wide text-[var(--muted)]">最新 P50 中位价</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-[var(--ink)]">
                {formatPrice(latest.p50, activeSeries.pricingUnit)}
              </p>
              <p className={`mt-2 text-sm font-semibold ${change >= 0 ? "text-[var(--warning)]" : "text-[var(--success)]"}`}>
                {change > 0 ? "+" : ""}{change.toFixed(1)}% / {range} 天
              </p>
              <dl className="mt-8 grid grid-cols-2 gap-x-5 gap-y-6">
                <div>
                  <dt className="text-xs text-[var(--muted)]">P25</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums text-[var(--ink)]">
                    {formatPrice(latest.p25, activeSeries.pricingUnit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted)]">P75</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums text-[var(--ink)]">
                    {formatPrice(latest.p75, activeSeries.pricingUnit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted)]">当日样本</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums text-[var(--ink)]">{latest.sampleCount} 条</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted)]">区域</dt>
                  <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">{activeSeries.region}</dd>
                </div>
              </dl>
              <div className="mt-8 border-t border-[var(--border)] pt-5">
                <p className="m-0 text-xs leading-5 text-[var(--muted)]">
                  更新于 {activeSeries.updatedAt} · 平均每日样本 {averageSamples} 条
                </p>
              </div>
            </div>

            <div className="min-w-0 p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="m-0 text-lg text-[var(--ink)]">价格分位走势</h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">色带为 P25–P75，横线为 P50 中位价</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-[var(--muted)]" aria-hidden="true">
                  <span className="flex items-center gap-2"><i className="h-3 w-3 bg-[var(--accent-soft)] ring-1 ring-[var(--border-strong)]" />P25–P75</span>
                  <span className="flex items-center gap-2"><i className="h-0.5 w-4 bg-[var(--accent)]" />P50</span>
                </div>
              </div>

              <div
                className="relative h-72 border-y border-[var(--border)] bg-[var(--info-bg)]"
                role="img"
                aria-label={`${activeSeries.label}从${fullDate(points[0].date)}至${fullDate(latest.date)}，P50中位价${direction}${Math.abs(change).toFixed(1)}%，最新价格${formatPrice(latest.p50, activeSeries.pricingUnit)}。`}
              >
                {[0, 1, 2, 3, 4].map((line) => (
                  <div
                    key={line}
                    className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--border)]"
                    style={{ top: `${line * 25}%` }}
                    aria-hidden="true"
                  />
                ))}
                <div className="absolute inset-0 flex items-end gap-px px-1 pt-3" aria-hidden="true">
                  {points.map((point) => {
                    const p25 = ((point.p25 - minValue) / chartSpan) * 84 + 6;
                    const p50 = ((point.p50 - minValue) / chartSpan) * 84 + 6;
                    const p75 = ((point.p75 - minValue) / chartSpan) * 84 + 6;
                    return (
                      <div key={point.date} className="relative h-full min-w-1 flex-1">
                        <div
                          className="absolute inset-x-[12%] bg-[var(--accent-soft)] ring-1 ring-inset ring-[var(--border-strong)]"
                          style={{ bottom: `${p25}%`, height: `${Math.max(p75 - p25, 1.5)}%` }}
                        />
                        <div
                          className="absolute inset-x-0 h-0.5 bg-[var(--accent)]"
                          style={{ bottom: `${p50}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-2 flex justify-between text-xs tabular-nums text-[var(--muted)]" aria-hidden="true">
                <span>{shortDate(points[0].date)}</span>
                <span>{shortDate(points[Math.floor((points.length - 1) / 2)].date)}</span>
                <span>{shortDate(latest.date)}</span>
              </div>
              <p className="mt-5 border-l-2 border-[var(--accent)] pl-4 text-sm leading-6 text-[var(--text)]">
                <strong className="text-[var(--ink)]">文字结论：</strong>
                过去 {range} 天，{activeSeries.label} 的 P50 中位价{direction}
                {Math.abs(change) > 0.05 ? ` ${Math.abs(change).toFixed(1)}%` : ""}；最新四分位区间为
                {formatPrice(latest.p25, activeSeries.pricingUnit)} 至 {formatPrice(latest.p75, activeSeries.pricingUnit)}。
              </p>

              <table className="sr-only">
                <caption>{activeSeries.label}近 {range} 天行情数据</caption>
                <thead><tr><th>日期</th><th>P25</th><th>P50</th><th>P75</th><th>样本量</th></tr></thead>
                <tbody>
                  {points.map((point) => (
                    <tr key={point.date}>
                      <td>{point.date}</td><td>{point.p25}</td><td>{point.p50}</td><td>{point.p75}</td><td>{point.sampleCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="mt-14" aria-labelledby="market-snapshot-title">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="kicker">Latest snapshot</p>
              <h2 id="market-snapshot-title" className="m-0 text-2xl text-[var(--ink)]">{CATEGORY_LABELS[category]}最新横截面</h2>
            </div>
            <p className="m-0 text-xs text-[var(--muted)]">市场参考报价 · 具体以询价确认为准</p>
          </div>
          <div className="data-table-wrap border border-[var(--border)]">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">基准</th>
                  <th scope="col">区域</th>
                  <th className="num" scope="col">P25</th>
                  <th className="num" scope="col">P50</th>
                  <th className="num" scope="col">P75</th>
                  <th className="num" scope="col">样本量</th>
                  <th scope="col">更新时间</th>
                </tr>
              </thead>
              <tbody>
                {visibleSeries.map((entry) => {
                  const point = entry.points[entry.points.length - 1];
                  return (
                    <tr key={entry.id}>
                      <th className="min-w-52 text-[var(--ink)]" scope="row">{entry.label}</th>
                      <td>{entry.region}</td>
                      <td className="num whitespace-nowrap">{formatPrice(point.p25, entry.pricingUnit)}</td>
                      <td className="num whitespace-nowrap font-semibold text-[var(--ink)]">{formatPrice(point.p50, entry.pricingUnit)}</td>
                      <td className="num whitespace-nowrap">{formatPrice(point.p75, entry.pricingUnit)}</td>
                      <td className="num">{point.sampleCount}</td>
                      <td className="whitespace-nowrap">{entry.updatedAt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
            说明：P25、P50、P75 为平台初始化报价样本的四分位统计；供应商接入后核验更新，具体以询价确认为准。
          </p>
        </section>
      </div>
    </div>
  );
}
