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
};

type RemoteModelMarketSummary = HomeMarketSummary;

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
    const oneDayChange = summary.indexChange1d === null
      ? "暂无"
      : `${summary.indexChange1d >= 0 ? "+" : ""}${summary.indexChange1d.toFixed(2)}%`;
    return [
      {
        label: "模型价格档位",
        value: String(summary.quoteCount),
        note: "条公开目录价快照",
      },
      {
        label: "模型成本指数",
        value: summary.indexCurrent.toFixed(2),
        note: "固定篮子 · 基期 100",
      },
      { label: "1 日变化", value: oneDayChange, note: "目录价成本趋势" },
      { label: "真实 GPU 市场", value: "独立入口", note: "仅 /gpu 展示可成交报价" },
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
            <Link className="button hero-primary-action" href="/gpu">进入真实 GPU 市场</Link>
            <Link className="hero-text-action" href="/resources">浏览参考目录 <span aria-hidden="true">→</span></Link>
          </div>
          <p className="hero-boundary"><span>真实 GPU 报价</span><span>卡时结账</span><span>目录仅供发现</span></p>
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
          <span><strong>{checkState === "error" ? "模型目录同步异常，使用上一份快照" : checkState === "checking" ? "正在核对模型目录价" : source === "persistent" ? "模型目录价已同步" : "模型目录价版本快照"}</strong> · 最近发布 {formatSnapshotTime(summary.publishedAt)}</span>
          <span>模型价格档位不是已核验资源、库存或可成交报价{checkState === "error" ? <button className="hero-retry" onClick={() => {
            setCheckState("checking");
            setRefreshKey((value) => value + 1);
          }} type="button">重试</button> : null}</span>
        </div>
      </div>
    </section>
  );
}
