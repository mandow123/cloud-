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

  const marketFacts = useMemo(() => {
    const payableCardHours = Math.ceil((summary.gpuP50 / 1.002) * 1_000_000) / 1_000_000;
    return [
      {
        label: "H100 网站价",
        value: new Intl.NumberFormat("zh-CN", {
          style: "currency",
          currency: summary.gpuCurrency,
          minimumFractionDigits: 2,
        }).format(summary.gpuP50),
        note: `/ ${summary.gpuPricingUnit}`,
      },
      {
        label: "1 小时应付",
        value: payableCardHours.toFixed(6),
        note: "KAI 卡时",
      },
      { label: "固定兑换", value: "1.002", note: "人民币 / KAI 卡时" },
      { label: "可交易报价", value: String(summary.quoteCount), note: "条已核验资源" },
    ];
  }, [summary]);

  return (
    <section className="kai-hero">
      <div aria-hidden="true" className="hero-grid-lines" />
      <div className="shell">
        <div className="hero-copy">
          <p className="hero-eyebrow">KAI CLOUD · COMPUTE MARKETPLACE</p>
          <h1 className="hero-title">让算力，抵达每一个需要它的时刻。</h1>
          <p className="hero-title-en" lang="en">Compute, ready for every moment that matters.</p>
          <p className="hero-lead">连接可信算力供给与真实需求，以 KAI 卡时统一结算；从资源锁定到交付验收，全程清晰、可查、可验。</p>
          <div className="hero-actions">
            <Link className="button hero-primary-action" href="/resources">探索算力市场</Link>
            <Link className="hero-text-action" href="/member#card-hours">了解 KAI 卡时 <span aria-hidden="true">→</span></Link>
          </div>
          <p className="hero-boundary"><span>实时资源</span><span>卡时结算</span><span>可信交付</span></p>
        </div>

        <dl aria-label="当前交易信息" className="hero-market-rail">
          {marketFacts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}<span>{fact.note}</span></dd>
            </div>
          ))}
        </dl>

        <div aria-live="polite" className="hero-status" role="status">
          <span><strong>{checkState === "error" ? "目录同步异常，使用安全快照" : checkState === "checking" ? "正在核对可交易目录" : source === "persistent" ? "可交易目录已同步" : "可交易目录安全快照"}</strong> · 最近发布 {formatSnapshotTime(summary.publishedAt)}</span>
          <span>全站资源仅支持 KAI 卡时结算 · 结账时锁定网站价{checkState === "error" ? <button className="hero-retry" onClick={() => {
            setCheckState("checking");
            setRefreshKey((value) => value + 1);
          }} type="button">重试</button> : null}</span>
        </div>
      </div>
    </section>
  );
}
