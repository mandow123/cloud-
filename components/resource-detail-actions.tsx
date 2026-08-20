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
  inquiryHref,
  inquiryUnavailable = false,
}: {
  resourceId: string;
  resourceTitle: string;
  requestHref: string;
  inquiryHref?: string;
  inquiryUnavailable?: boolean;
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
      {inquiryUnavailable ? <span className="button button-secondary w-full cursor-not-allowed" aria-disabled="true">人工询价维护中</span> : <Link
        className="button button-primary w-full"
        href={inquiryHref ?? requestHref}
        aria-label={inquiryHref ? `登录后询价${resourceTitle}` : `基于${resourceTitle}提交需求`}
      >
        {inquiryHref ? "登录后提交询价" : "提交相关算力需求"}
        <span aria-hidden="true">→</span>
      </Link>}
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
        关注状态仅保存在当前设备。{inquiryUnavailable ? "当前只能浏览供应商报价，人工询价入口尚未开放。" : inquiryHref ? "提交仅生成询价申请，不锁库存、不支付、不成交。" : "提交需求不会自动触发采购、支付或资源开通。"}
      </p>
    </div>
  );
}
