"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export type HomeMarketSummary = {
  publishedAt: string;
  quoteCount: number;
  indexCurrent: number;
  indexChange1d: number | null;
  indexChange7d: number | null;
  indexChange30d: number | null;
  gpuP50: number;
  gpuCurrency: "CNY";
  gpuPricingUnit: string;
  gpuResourceTitle: string;
};

type RemoteModelMarketSummary = Omit<
  HomeMarketSummary,
  "gpuP50" | "gpuCurrency" | "gpuPricingUnit" | "gpuResourceTitle"
>;

function formatIndexChange(label: string, value: number | null) {
  if (value === null || !Number.isFinite(value)) return `${label} 暂无`;
  return `${label} ${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatSnapshotTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatSnapshotDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "当前行情";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function LiveHomeMarketHero({
  initialSummary,
  initialSource,
}: {
  initialSummary: HomeMarketSummary;
  initialSource: "persistent" | "bundled";
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [source, setSource] = useState<"persistent" | "bundled">(initialSource);
  const [checkState, setCheckState] = useState<"checking" | "ready" | "error">("checking");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setCheckState("error");
      controller.abort();
    }, 12_000);
    fetch("/api/market?summary=1", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("market unavailable");
        return response.json() as Promise<{ summary: RemoteModelMarketSummary; source: "persistent" | "bundled" }>;
      })
      .then((result) => {
        setSummary((current) => ({ ...current, ...result.summary }));
        setSource(result.source);
        setCheckState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCheckState("error");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [refreshKey]);

  const signals = useMemo(() => {
    const indexChanges = [summary.indexChange1d, summary.indexChange7d, summary.indexChange30d];
    const changeSummary = [
      formatIndexChange("1 日", summary.indexChange1d),
      formatIndexChange("7 日", summary.indexChange7d),
      formatIndexChange("30 日", summary.indexChange30d),
    ].join(" · ");
    return [
      {
        label: "GPU 算力 P50",
        value: `${summary.gpuCurrency} ${new Intl.NumberFormat("zh-CN", {
          style: "currency",
          currency: summary.gpuCurrency,
          minimumFractionDigits: 2,
        }).format(summary.gpuP50)}`,
        unit: `/ ${summary.gpuPricingUnit}`,
        change: summary.gpuResourceTitle,
      },
      {
        label: "主流模型成本指数",
        value: summary.indexCurrent.toFixed(1),
        unit: "固定模型篮子",
        change: indexChanges.every((value) => value === null)
          ? `样本积累中 · ${changeSummary}`
          : changeSummary,
      },
      { label: "模型分项报价", value: String(summary.quoteCount), unit: "个价格档位", change: "输入 / 缓存 / 输出分别计价" },
    ];
  }, [summary]);

  return (
    <section className="kai-hero">
      <div className="shell">
        <div className="hero-status" role="status">
          <span><strong>{checkState === "error" ? "更新失败，显示上次数据" : checkState === "checking" ? "正在核对发布时间" : source === "persistent" ? "行情库已更新" : "显示上次发布行情"}</strong> · 发布时间 {formatSnapshotTime(summary.publishedAt)}</span>
          <span>{summary.quoteCount} 个模型价格档位 · 每日北京时间 06:00 更新{checkState === "error" ? <button className="ml-2 font-semibold underline" onClick={() => {
            setCheckState("checking");
            setRefreshKey((value) => value + 1);
          }} type="button">重试</button> : null}</span>
        </div>

        <div className="hero-grid">
          <div className="hero-copy">
            <p className="hero-eyebrow">中国 Token 学院算力市场</p>
            <div className="hero-heading-row">
              <h1 className="hero-title">今日算力报价</h1>
              <span>{formatSnapshotDate(summary.publishedAt)}</span>
            </div>
            <p className="hero-lead">
              GPU、模型 Token、整机柜与云厂商资源，按统一口径显示价格、样本和有效期。
            </p>
            <dl className="hero-primary-quote">
              <dt>{summary.gpuResourceTitle}<span>市场 P50</span></dt>
              <dd>
                {new Intl.NumberFormat("zh-CN", {
                  style: "currency",
                  currency: summary.gpuCurrency,
                  minimumFractionDigits: 2,
                }).format(summary.gpuP50)}
                <span>/ {summary.gpuPricingUnit}</span>
              </dd>
            </dl>
            <div className="hero-actions">
              <Link className="button hero-primary-action" href="/market">查看全部报价</Link>
              <Link className="button hero-secondary-action" href="/request">发布采购需求</Link>
              <Link className="hero-supply-action" href="/member?role=supplier#supply-register">登记可供算力 →</Link>
            </div>
            <p className="hero-boundary">成交前需确认税费、电费、网络、可用容量与交付时间。</p>
          </div>

          <aside className="signal-board" aria-labelledby="signal-board-title">
            <div className="signal-board-head">
              <div>
                <p className="signal-kicker">行情摘要</p>
                <h2 id="signal-board-title">截至 {formatSnapshotTime(summary.publishedAt)}</h2>
              </div>
              <Link href="/methodology">数据口径</Link>
            </div>
            <dl>
              {signals.map((signal) => (
                <div className="signal-row" key={signal.label}>
                  <dt>{signal.label}<span>{signal.change}</span></dt>
                  <dd>{signal.value}<span>{signal.unit}</span></dd>
                </div>
              ))}
            </dl>
            <p className="signal-note">指数只比较固定模型篮子的成本变化，不是统一 Token 单价；各模型输入、缓存与输出价格在行情页分项展示。</p>
          </aside>
        </div>
      </div>
    </section>
  );
}
