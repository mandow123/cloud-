"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import styles from "./account-console-overview.module.css";

type AccountConsoleSummary = {
  account: { displayName: string; organizationName: string; subjectStatus: "ACTIVE" };
  buyer: {
    cardHours: { availableMicros: number; heldMicros: number };
    purchaseIntents: {
      total: number;
      pendingManualDelivery: number;
      recent: Array<{ demandId: string; status: "PENDING_MANUAL_DELIVERY"; resourceTitle: string; supplierName: string; estimatedCardHourMicros: number; createdAt: string }>;
    };
  };
  supplier: {
    available: boolean;
    approved: boolean;
    status: "NOT_SUBMITTED" | "PENDING_REVIEW" | "NEEDS_ATTENTION" | "VERIFIED_NOT_PUBLISHED" | "PUBLISHED";
    subjectStatus: "ACTIVE";
    applications: {
      total: number;
      pendingReview: number;
      approved: number;
      verified: number;
      published: number;
      needsAttention: number;
      recent: Array<{ id: string; productName: string; resourceType: string; status: "DRAFT" | "SUBMITTED" | "UNDER_VERIFICATION" | "VERIFIED" | "REJECTED" | "PUBLISHED"; createdAt: string }>;
    };
  };
};

const supplyStatusLabels: Record<AccountConsoleSummary["supplier"]["applications"]["recent"][number]["status"], string> = {
  DRAFT: "未提交",
  SUBMITTED: "待平台审核",
  UNDER_VERIFICATION: "待平台审核",
  VERIFIED: "申请已通过（尚未发布）",
  REJECTED: "需补充资料",
  PUBLISHED: "已由平台人工发布",
};

const resourceTypeLabels: Record<string, string> = {
  GPU_CARD: "GPU 显卡",
  GPU_SERVER: "GPU 服务器",
  CPU_SERVER: "CPU 服务器",
  MAC_COMPUTE: "Mac 算力",
  TOKEN_CAPACITY: "Token 容量",
  MODEL_INSTANCE: "模型实例",
  NAS_STORAGE: "NAS 存储",
  RACK_CAPACITY: "机柜容量",
  CLOUD_RESOURCE: "云资源",
};

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function loadSummary(signal: AbortSignal) {
  const response = await fetch("/api/v1/member/account-console-summary", { credentials: "same-origin", cache: "no-store", signal });
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? "账户数据暂时无法读取。");
  return payload as AccountConsoleSummary;
}

function BuyerOverview({ summary }: { summary: AccountConsoleSummary }) {
  const intents = summary.buyer.purchaseIntents;
  return <>
    <header className={styles.heading}>
      <div><p>BUYER ACCOUNT</p><h1>采购总览</h1><span>{summary.account.organizationName} · 所有数字只属于当前组织</span></div>
      <div className={styles.actions}><Link className={styles.primaryAction} href="/gpu">浏览 GPU 目录</Link><Link className={styles.secondaryAction} href="/request">提交算力需求</Link></div>
    </header>

    <section className={styles.metrics} aria-label="采购账户摘要">
      <article id="card-hours"><span>可用 KAI 标准卡时</span><strong>{formatCardHourDisplayMicros(summary.buyer.cardHours.availableMicros)}</strong><small>真实账本余额 · 两位小数</small></article>
      <article><span>算力申请</span><strong>{intents.total}</strong><small>当前组织的不可变申请快照</small></article>
      <article><span>待人工确认与交付</span><strong>{intents.pendingManualDelivery}</strong><small>未锁库存、未付款、未扣卡时</small></article>
      <article><span>已锁定卡时</span><strong>{formatCardHourDisplayMicros(summary.buyer.cardHours.heldMicros)}</strong><small>只读取真实账本，不由页面估算</small></article>
    </section>

    <section className={styles.panel} aria-labelledby="buyer-recent-title">
      <div className={styles.panelHeading}><div><p>RECENT REQUESTS</p><h2 id="buyer-recent-title">最近算力申请</h2></div><Link href="/member/purchases">查看全部</Link></div>
      {intents.recent.length ? <div className={styles.records}>{intents.recent.map((record) => <article className={styles.record} key={record.demandId}>
        <div><span className={styles.recordType}>等待平台人工确认与交付</span><h3>{record.resourceTitle}</h3><p>{record.supplierName} · {record.demandId}</p></div>
        <div className={styles.recordFacts}><strong>{formatCardHourDisplayMicros(record.estimatedCardHourMicros)} 卡时</strong><span>询价参考 · 尚未扣减</span><time dateTime={record.createdAt}>{dateTime(record.createdAt)}</time></div>
        <Link aria-label={`查看 ${record.resourceTitle} 申请详情`} href={`/member/purchases/${encodeURIComponent(record.demandId)}`}>查看详情</Link>
      </article>)}</div> : <div className={styles.empty}><strong>还没有算力申请</strong><p>从 GPU 目录选择资源并提交询价后，冻结的资源与卡时参考会显示在这里。</p><Link href="/gpu">浏览 GPU 目录 →</Link></div>}
    </section>

    <section className={styles.compactPanel} id="compare"><div><p>RESOURCE COMPARE</p><h2>资源对比</h2><span>对比选择保存在当前浏览器，不代表下单或锁库存。</span></div><Link className={styles.secondaryAction} href="/resources">选择资源</Link></section>
  </>;
}

function supplierHeadline(summary: AccountConsoleSummary) {
  const applications = summary.supplier.applications;
  if (summary.supplier.status === "NEEDS_ATTENTION") return { label: "需补充资料", detail: "请查看最近申请并按平台反馈完善资料。" };
  if (summary.supplier.status === "PUBLISHED") return { label: "已有资源由平台人工发布", detail: `${applications.published} 条申请记录为已发布；库存、价格和成交仍以人工确认结果为准。` };
  if (summary.supplier.status === "VERIFIED_NOT_PUBLISHED") return { label: "申请已通过（尚未发布）", detail: "审核通过不等于已发布、可售或已成交。" };
  if (summary.supplier.status === "PENDING_REVIEW") return { label: "待平台审核", detail: "平台正在人工核对申请资料，不承诺自动验真或发布时间。" };
  return { label: "尚未提交供应资源", detail: "先提交最少必要的资源资料，平台人工审核后再决定是否发布。" };
}

function SupplierOverview({ summary }: { summary: AccountConsoleSummary }) {
  const applications = summary.supplier.applications;
  const headline = supplierHeadline(summary);
  return <>
    <header className={styles.heading}>
      <div><p>SUPPLIER ACCOUNT</p><h1>供应总览</h1><span>{summary.account.organizationName} · 供应数据与采购数据分别统计</span></div>
      <div className={styles.actions}><Link className={styles.primaryAction} href="/supply/apply">提交新资源</Link><Link className={styles.secondaryAction} href="/hosting/partners">阅读上架要求</Link></div>
    </header>

    <section className={styles.statusPanel} aria-labelledby="supplier-status-title">
      <div><p>SUPPLIER STATUS</p><h2 id="supplier-status-title">{headline.label}</h2><span>{headline.detail}</span></div>
      <Link href="/supply/applications">查看申请记录 →</Link>
    </section>

    <section className={styles.metrics} aria-label="供应账户摘要">
      <article><span>上架申请</span><strong>{applications.total}</strong><small>当前组织真实提交记录</small></article>
      <article><span>待平台审核</span><strong>{applications.pendingReview}</strong><small>已提交或审核中</small></article>
      <article><span>申请已通过</span><strong>{applications.verified}</strong><small>尚未发布或成交</small></article>
      <article><span>平台人工发布</span><strong>{applications.published}</strong><small>不代表已锁库存或已成交</small></article>
    </section>

    <section className={styles.panel} aria-labelledby="supplier-recent-title">
      <div className={styles.panelHeading}><div><p>RECENT SUBMISSIONS</p><h2 id="supplier-recent-title">最近上架申请</h2></div><Link href="/supply/applications">查看全部</Link></div>
      {applications.recent.length ? <div className={styles.records}>{applications.recent.map((record) => <article className={styles.record} key={record.id}>
        <div><span className={styles.recordType}>{resourceTypeLabels[record.resourceType] ?? "供应资源"}</span><h3>{record.productName}</h3><p>{record.id}</p></div>
        <div className={styles.recordFacts}>
          <strong>{supplyStatusLabels[record.status]}</strong>
          <span>{record.status === "PUBLISHED" ? "已发布不代表已锁库存、已成交或运行中" : "不代表已发布、已成交或运行中"}</span>
          <time dateTime={record.createdAt}>{dateTime(record.createdAt)}</time>
        </div>
        <Link href="/supply/applications">查看记录</Link>
      </article>)}</div> : <div className={styles.empty}><strong>还未提交供应资源</strong><p>提交后记录会写入数据库，并进入管理员人工审核队列。</p><Link href="/supply/apply">开始上架 →</Link></div>}
    </section>
  </>;
}

export function AccountConsoleOverview({ mode }: { mode: "buyer" | "supplier" }) {
  const [summary, setSummary] = useState<AccountConsoleSummary | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setSummary(null); setError(""); setAttempt((value) => value + 1); }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadSummary(controller.signal).then(setSummary).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "账户数据暂时无法读取。");
    });
    return () => controller.abort();
  }, [attempt]);

  if (error) return <section className={styles.error} role="alert"><h1>账户数据读取失败</h1><p>{error}</p><p>页面不会把服务异常显示成 0，也不会用本地数据补齐。</p><button className={styles.primaryAction} onClick={retry} type="button">重新读取</button></section>;
  if (!summary) return <div className={styles.loading} role="status">正在读取当前组织的真实账户数据…</div>;
  return <div className={styles.overview}>{mode === "buyer" ? <BuyerOverview summary={summary} /> : <SupplierOverview summary={summary} />}</div>;
}
