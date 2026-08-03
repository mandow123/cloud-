"use client";

import { useEffect, useState } from "react";
import {
  ModelPriceBoard,
  type ModelCostIndexSnapshot,
  type ModelTokenPriceQuote,
} from "@/components/model-price-board";

type ModelSnapshot = {
  quotes: ModelTokenPriceQuote[];
  index: ModelCostIndexSnapshot;
  publishedAt: string;
};

export function LiveModelPriceBoard({
  initialSnapshot,
  initialSource,
}: {
  initialSnapshot: ModelSnapshot;
  initialSource: "persistent" | "bundled";
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [source, setSource] = useState<"persistent" | "bundled">(initialSource);
  const [refreshKey, setRefreshKey] = useState(0);
  const [checkState, setCheckState] = useState<"checking" | "ready" | "error">("checking");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setCheckState("error");
      controller.abort();
    }, 12_000);
    fetch("/api/market", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("market unavailable");
        return response.json() as Promise<{ snapshot: ModelSnapshot; source: "persistent" | "bundled" }>;
      })
      .then((result) => {
        setSnapshot(result.snapshot);
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

  return (
    <div>
      <p className="mb-4 border-l-2 border-[var(--accent)] pl-3 text-sm text-[var(--text)]" role="status">
        {checkState === "checking"
          ? "正在检查最新行情"
          : checkState === "error"
            ? "最新检查失败，继续使用上一份安全快照"
            : source === "persistent" ? "已读取 06:00 持久化行情快照" : "正在使用随版本发布的安全快照"}
        <span className="text-[var(--muted)]"> · {snapshot.quotes.length} 个模型价格档位 · 发布于 {new Date(snapshot.publishedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</span>
        {checkState === "error" ? <button className="ml-3 font-semibold text-[var(--accent)] underline" onClick={() => {
          setCheckState("checking");
          setRefreshKey((value) => value + 1);
        }} type="button">重新检查</button> : null}
      </p>
      <ModelPriceBoard quotes={snapshot.quotes} index={snapshot.index} />
    </div>
  );
}
