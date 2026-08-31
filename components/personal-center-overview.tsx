"use client";

import Link from "next/link";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { resourceListings } from "@/lib/data";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";
import { BusinessValue, localizeNode as localizeFixedNode } from "@/components/render-time-localization";

const COMPARE_KEY = "kai-cloud-compare-v1";

const EN: Record<string, string> = {
  "主体已启用": "Entity active", "主体待完善": "Entity pending", "主体已停用": "Entity suspended",
  "个人摘要暂时无法读取": "Personal summary is temporarily unavailable", "页面不会用本地数字代替订单和支付状态；下方交易工作台仍可独立读取。": "Local numbers never replace order or payment status. The transaction workspace below can still load independently.",
  "正在读取个人资料与交易待办…": "Loading profile and transaction tasks…", "登录后管理个人交易": "Sign in to manage personal transactions", "购买申请、正式订单、支付与验收只按已登录账户的当前交易主体读取；公开资源仍可匿名浏览。": "Purchase requests, orders, payments, and acceptance are read only for the signed-in account’s active entity. Public resources remain available anonymously.", "统一账号登录": "Sign in with unified account",
  "购买申请": "Purchase requests", "平台核验库存与正式价格": "Platform verifies inventory and final price", "待支付": "Pending payment", "仅统计有效正式付款单": "Only valid formal payment orders are counted", "支付服务暂未开通": "Payment service is not available", "我的订单": "My orders", "待验收": "Pending acceptance", "服务完成后由买方确认": "Buyer confirms after service completion", "我的对比": "My comparison", "本机保存，最多 3 项": "Saved on this device, up to 3 items",
  "个人账户概览": "Personal account overview", "个": "U", "未登记公开邮箱": "No public email registered", "当前交易主体": "Active trading entity", "主体状态": "Entity status", "个人快捷入口": "Personal shortcuts",
  "继续选择资源": "Choose more resources", "尚未加入对比。资源市场中的“加入对比”会保存在当前浏览器。": "No resources have been added. “Add to comparison” in the resource market is saved in this browser.",
  "含": "Includes", "笔 GPU 租赁合同": "GPU rental contracts", "笔 GPU 租赁待确认": "GPU rentals pending confirmation", "我的对比 ·": "My comparison ·",
};
const CORE: Record<Exclude<Locale, "zh-CN" | "en">, Record<string, string>> = {
  "zh-TW": { "个人摘要暂时无法读取": "個人摘要暫時無法讀取", "我的订单": "我的訂單", "我的对比": "我的比較", "待支付": "待支付", "待验收": "待驗收" },
  ja: { "个人摘要暂时无法读取": "個人サマリーを読み込めません", "我的订单": "注文", "我的对比": "比較", "待支付": "支払い待ち", "待验收": "検収待ち" },
  ko: { "个人摘要暂时无法读取": "개인 요약을 불러올 수 없습니다", "我的订单": "내 주문", "我的对比": "내 비교", "待支付": "결제 대기", "待验收": "검수 대기" },
  fr: { "个人摘要暂时无法读取": "Résumé personnel indisponible", "我的订单": "Mes commandes", "我的对比": "Ma comparaison", "待支付": "Paiement en attente", "待验收": "Réception en attente" },
  th: { "个人摘要暂时无法读取": "ไม่สามารถอ่านข้อมูลส่วนตัวได้", "我的订单": "คำสั่งซื้อของฉัน", "我的对比": "รายการเปรียบเทียบ", "待支付": "รอชำระ", "待验收": "รอตรวจรับ" },
  vi: { "个人摘要暂时无法读取": "Không thể đọc tóm tắt cá nhân", "我的订单": "Đơn hàng của tôi", "我的对比": "So sánh của tôi", "待支付": "Chờ thanh toán", "待验收": "Chờ nghiệm thu" },
  id: { "个人摘要暂时无法读取": "Ringkasan pribadi tidak tersedia", "我的订单": "Pesanan saya", "我的对比": "Perbandingan saya", "待支付": "Menunggu pembayaran", "待验收": "Menunggu penerimaan" },
  ms: { "个人摘要暂时无法读取": "Ringkasan peribadi tidak tersedia", "我的订单": "Pesanan saya", "我的对比": "Perbandingan saya", "待支付": "Menunggu bayaran", "待验收": "Menunggu penerimaan" },
};

function localizeText(locale: Locale, value: string) {
  if (locale === "zh-CN") return value;
  const trimmed = value.trim();
  const translated = (locale === "en" ? undefined : CORE[locale][trimmed]) ?? EN[trimmed];
  return translated ? value.replace(trimmed, translated) : value;
}

function localizeNode(locale: Locale, node: ReactNode): ReactNode {
  return localizeFixedNode(node, (value) => localizeText(locale, value));
}

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
  const { locale } = useLocale();
  const render = (node: ReactNode) => localizeNode(locale, node) as ReactElement;
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
    return render(
      <section className="mb-12 border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-5" aria-labelledby="personal-summary-error">
        <h2 className="m-0 text-xl" id="personal-summary-error">个人摘要暂时无法读取</h2>
        <p className="mb-0 mt-2 text-sm">页面不会用本地数字代替订单和支付状态；下方交易工作台仍可独立读取。</p>
      </section>
    );
  }

  if (!summary) {
    return render(<div className="mb-12 border-l-2 border-[var(--accent)] pl-4" role="status">正在读取个人资料与交易待办…</div>);
  }

  if (!summary.authenticated || !summary.profile || !summary.counts) {
    return render(
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
    { target: "purchase-requests", label: "购买申请", value: <BusinessValue>{count(summary.counts.purchaseRequests)}</BusinessValue>, detail: "平台核验库存与正式价格" },
    { anchor: "pending-payment", target: "orders", label: "待支付", value: <BusinessValue>{count(summary.counts.pendingPayment)}</BusinessValue>, detail: summary.payment?.ready ? "仅统计有效正式付款单" : (summary.payment?.reason ? <BusinessValue>{summary.payment.reason}</BusinessValue> : "支付服务暂未开通") },
    { target: "orders", label: "我的订单", value: <BusinessValue>{count(summary.counts.orders)}</BusinessValue>, detail: <>含 <BusinessValue>{count(summary.counts.gpuContracts)}</BusinessValue> 笔 GPU 租赁合同</> },
    { anchor: "pending-acceptance", target: "orders", label: "待验收", value: <BusinessValue>{count(summary.counts.pendingAcceptance)}</BusinessValue>, detail: summary.counts.gpuPendingAcceptance > 0 ? <><BusinessValue>{count(summary.counts.gpuPendingAcceptance)}</BusinessValue> 笔 GPU 租赁待确认</> : "服务完成后由买方确认" },
    { target: "compare", label: "我的对比", value: <BusinessValue>{String(compareItems.length)}</BusinessValue>, detail: "本机保存，最多 3 项" },
  ];

  return render(
    <div className="mb-14" aria-label="个人账户概览">
      <section className="grid gap-px bg-[var(--border)] lg:grid-cols-[minmax(0,1fr)_360px]" id="profile">
        <div className="bg-[var(--surface)] p-6 sm:p-8">
          <p className="kicker">PERSONAL OVERVIEW</p>
          <div className="flex items-center gap-4">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--border)] text-lg font-semibold text-[var(--text)]" aria-hidden="true">
              {summary.profile.displayName.trim() ? <BusinessValue>{summary.profile.displayName.trim().slice(0, 1).toUpperCase()}</BusinessValue> : "个"}
            </span>
            <div>
              <h2 className="m-0 text-2xl"><BusinessValue>{summary.profile.displayName}</BusinessValue></h2>
              <p className="m-0 mt-1 text-sm text-[var(--muted)]">{summary.profile.maskedEmail ? <BusinessValue>{summary.profile.maskedEmail}</BusinessValue> : "未登记公开邮箱"}</p>
            </div>
          </div>
        </div>
        <dl className="m-0 grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-1">
          <div className="bg-[var(--info-bg)] p-5"><dt className="text-xs text-[var(--muted)]">当前交易主体</dt><dd className="m-0 mt-1 font-semibold text-[var(--ink)]"><BusinessValue>{summary.profile.organizationName}</BusinessValue></dd></div>
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
          <div><p className="kicker">COMPARE</p><h2 className="m-0 text-2xl" id="personal-compare-title">我的对比 · <BusinessValue>{compareItems.length}/3</BusinessValue></h2></div>
          <Link className="button button-secondary button-compact" href="/resources">继续选择资源</Link>
        </div>
        {compareItems.length ? (
          <div className="mt-5 grid gap-px bg-[var(--border)] sm:grid-cols-3">
            {compareItems.map((item) => (
              <Link className="bg-[var(--info-bg)] p-4 no-underline" href={`/resources/${encodeURIComponent(item.id)}`} key={item.id}>
                <strong className="block text-[var(--ink)]"><BusinessValue>{item.title}</BusinessValue></strong>
                <span className="mt-1 block text-xs text-[var(--muted)]"><BusinessValue>{item.region} · {item.deliveryForm}</BusinessValue></span>
              </Link>
            ))}
          </div>
        ) : <p className="mb-0 mt-4 text-sm text-[var(--muted)]">尚未加入对比。资源市场中的“加入对比”会保存在当前浏览器。</p>}
      </section>
    </div>
  );
}
