"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

const WATCHLIST_KEY = "kai-cloud-demo-watchlist-v1";

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
        关注状态仅保存在当前设备。发布需求不会触发真实采购、支付或资源开通。
      </p>
    </div>
  );
}
