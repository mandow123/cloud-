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

export function LiveModelPriceBoard({ initialSnapshot }: { initialSnapshot: ModelSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [source, setSource] = useState<"persistent" | "bundled">("bundled");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/market", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("market unavailable");
        return response.json() as Promise<{ snapshot: ModelSnapshot; source: "persistent" | "bundled" }>;
      })
      .then((result) => {
        setSnapshot(result.snapshot);
        setSource(result.source);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
    return () => controller.abort();
  }, []);

  return (
    <div>
      <p className="mb-4 border-l-2 border-[var(--accent)] pl-3 text-sm text-[var(--text)]" role="status">
        {source === "persistent" ? "已读取 06:00 持久化行情快照" : "正在使用随版本发布的安全快照"}
        <span className="text-[var(--muted)]"> · {snapshot.quotes.length} 个模型价格档位 · 发布于 {new Date(snapshot.publishedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</span>
      </p>
      <ModelPriceBoard quotes={snapshot.quotes} index={snapshot.index} />
    </div>
  );
}
