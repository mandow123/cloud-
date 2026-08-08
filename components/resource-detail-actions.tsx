"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

const WATCHLIST_KEY = "kai-cloud-watchlist-v1";

function readWatchlist(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WATCHLIST_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function subscribeWatchlist(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("kai-watchlist-changed", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("kai-watchlist-changed", onStoreChange);
  };
}

export function ResourceDetailActions({
  resourceId,
  resourceTitle,
  requestHref,
}: {
  resourceId: string;
  resourceTitle: string;
  requestHref: string;
}) {
  const watched = useSyncExternalStore(
    subscribeWatchlist,
    () => readWatchlist().includes(resourceId),
    () => false,
  );

  function toggleWatch() {
    const current = readWatchlist();
    const next = current.includes(resourceId)
      ? current.filter((id) => id !== resourceId)
      : [...current, resourceId];

    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("kai-watchlist-changed", { detail: next }));
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
      <Link
        className="button button-primary w-full"
        href="/market/listings"
      >
        查看可购买的在售资源
        <span aria-hidden="true">→</span>
      </Link>
      <Link
        className="button button-secondary w-full"
        href={requestHref}
        aria-label={`基于${resourceTitle}发布需求`}
      >
        基于此资源发布需求
        <span aria-hidden="true">→</span>
      </Link>
      <button
        className="button button-secondary w-full cursor-pointer"
        type="button"
        aria-pressed={watched}
        onClick={toggleWatch}
      >
        <span aria-hidden="true">{watched ? "●" : "○"}</span>
        {watched ? "已关注此资源" : "关注此资源"}
      </button>
      <p className="m-0 text-xs leading-5 text-[var(--muted)] sm:col-span-2 lg:col-span-1">
        目录报价用于比较；购买入口只展示已核验且仍在有效期内的在售容量。关注状态仅保存在当前设备。
      </p>
    </div>
  );
}
