"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { resourceListings } from "@/lib/data";

const COMPARE_KEY = "kai-cloud-compare-v1";

type PersonalSummary = {
  authenticated: boolean;
  profile?: {
    displayName: string;
    maskedEmail: string | null;
    organizationName: string;
    subjectStatus: "PENDING" | "ACTIVE" | "SUSPENDED";
  };
  counts?: {
    purchaseRequests: number;
    orders: number;
    pendingPayment: number;
    pendingAcceptance: number;
    gpuContracts: number;
    gpuPendingAcceptance: number;
  };
  payment?: { ready: boolean; reason?: string };
};

function readCompareIds() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMPARE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, 3)
      : [];
  } catch {
    return [];
  }
}

type SubjectStatus = NonNullable<PersonalSummary["profile"]>["subjectStatus"];

function statusLabel(status: SubjectStatus) {
  if (status === "ACTIVE") return "主体已启用";
  if (status === "PENDING") return "主体待完善";
  return "主体已停用";
}

export function PersonalCenterOverview() {
  const [summary, setSummary] = useState<PersonalSummary | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/member/personal-summary", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("PERSONAL_SUMMARY_UNAVAILABLE");
        return response.json() as Promise<PersonalSummary>;
      })
      .then(setSummary)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const sync = () => setCompareIds(readCompareIds());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("kai-compare-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("kai-compare-changed", sync);
    };
  }, []);

  if (failed) {
    return (
      <section className="mb-12 border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-5" aria-labelledby="personal-summary-error">
        <h2 className="m-0 text-xl" id="personal-summary-error">个人摘要暂时无法读取</h2>
        <p className="mb-0 mt-2 text-sm">页面不会用本地数字代替订单和支付状态；下方交易工作台仍可独立读取。</p>
      </section>
    );
  }

  if (!summary) {
    return <div className="mb-12 border-l-2 border-[var(--accent)] pl-4" role="status">正在读取个人资料与交易待办…</div>;
  }

  if (!summary.authenticated || !summary.profile || !summary.counts) {
    return (
      <section className="mb-12 grid gap-5 border-y border-[var(--border)] bg-[var(--surface)] p-6 sm:grid-cols-[1fr_auto] sm:items-center" id="profile" aria-labelledby="personal-sign-in-title">
        <div>
          <p className="kicker">PERSONAL</p>
          <h2 className="m-0 text-2xl" id="personal-sign-in-title">登录后管理个人交易</h2>
          <p className="mb-0 mt-2 text-sm">购买申请、正式订单、支付与验收只按已登录账户的当前交易主体读取；公开资源仍可匿名浏览。</p>
        </div>
        <Link className="button button-primary min-h-12 justify-center" href="/login?returnTo=%2Fmember">统一账号登录</Link>
      </section>
    );
  }

  const compareItems = compareIds
    .map((id) => resourceListings.find((item) => item.id === id))
    .filter((item): item is (typeof resourceListings)[number] => Boolean(item));
  const count = (value: number) => Number.isFinite(value) ? String(value) : "—";
  const cards = [
    { target: "purchase-requests", label: "购买申请", value: count(summary.counts.purchaseRequests), detail: "平台核验库存与正式价格" },
    { anchor: "pending-payment", target: "orders", label: "待支付", value: count(summary.counts.pendingPayment), detail: summary.payment?.ready ? "仅统计有效正式付款单" : (summary.payment?.reason || "支付服务暂未开通") },
    { target: "orders", label: "我的订单", value: count(summary.counts.orders), detail: `含 ${count(summary.counts.gpuContracts)} 笔 GPU 租赁合同` },
    { anchor: "pending-acceptance", target: "orders", label: "待验收", value: count(summary.counts.pendingAcceptance), detail: summary.counts.gpuPendingAcceptance > 0 ? `${count(summary.counts.gpuPendingAcceptance)} 笔 GPU 租赁待确认` : "服务完成后由买方确认" },
    { target: "compare", label: "我的对比", value: String(compareItems.length), detail: "本机保存，最多 3 项" },
  ];

  return (
    <div className="mb-14" aria-label="个人账户概览">
      <section className="grid gap-px bg-[var(--border)] lg:grid-cols-[minmax(0,1fr)_360px]" id="profile">
        <div className="bg-[var(--surface)] p-6 sm:p-8">
          <p className="kicker">PERSONAL OVERVIEW</p>
          <div className="flex items-center gap-4">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--border)] text-lg font-semibold text-[var(--text)]" aria-hidden="true">
              {summary.profile.displayName.trim().slice(0, 1).toUpperCase() || "个"}
            </span>
            <div>
              <h2 className="m-0 text-2xl">{summary.profile.displayName}</h2>
              <p className="m-0 mt-1 text-sm text-[var(--muted)]">{summary.profile.maskedEmail || "未登记公开邮箱"}</p>
            </div>
          </div>
        </div>
        <dl className="m-0 grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-1">
          <div className="bg-[var(--info-bg)] p-5"><dt className="text-xs text-[var(--muted)]">当前交易主体</dt><dd className="m-0 mt-1 font-semibold text-[var(--ink)]">{summary.profile.organizationName}</dd></div>
          <div className="bg-[var(--info-bg)] p-5"><dt className="text-xs text-[var(--muted)]">主体状态</dt><dd className="m-0 mt-1 font-semibold text-[var(--ink)]">{statusLabel(summary.profile.subjectStatus)}</dd></div>
        </dl>
      </section>

      <section className="mt-px grid gap-px bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-5" aria-label="个人快捷入口">
        {cards.map((card) => (
          <a className="group scroll-mt-28 bg-[var(--surface)] p-5 no-underline hover:bg-[var(--info-bg)]" href={`#${card.target}`} id={card.anchor} key={card.label}>
            <span className="text-sm font-semibold text-[var(--text)]">{card.label}</span>
            <strong className="mt-2 block text-3xl tabular-nums text-[var(--ink)]">{card.value}</strong>
            <small className="mt-2 block leading-5 text-[var(--muted)]">{card.detail}</small>
          </a>
        ))}
      </section>

      <section className="mt-8 scroll-mt-28 border-t-2 border-[var(--accent)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)]" id="compare" aria-labelledby="personal-compare-title">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="kicker">COMPARE</p><h2 className="m-0 text-2xl" id="personal-compare-title">我的对比 · {compareItems.length}/3</h2></div>
          <Link className="button button-secondary button-compact" href="/resources">继续选择资源</Link>
        </div>
        {compareItems.length ? (
          <div className="mt-5 grid gap-px bg-[var(--border)] sm:grid-cols-3">
            {compareItems.map((item) => (
              <Link className="bg-[var(--info-bg)] p-4 no-underline" href={`/resources/${encodeURIComponent(item.id)}`} key={item.id}>
                <strong className="block text-[var(--ink)]">{item.title}</strong>
                <span className="mt-1 block text-xs text-[var(--muted)]">{item.region} · {item.deliveryForm}</span>
              </Link>
            ))}
          </div>
        ) : <p className="mb-0 mt-4 text-sm text-[var(--muted)]">尚未加入对比。资源市场中的“加入对比”会保存在当前浏览器。</p>}
      </section>
    </div>
  );
}
