"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import { createIdempotencyKey, marketplaceErrorMessage, marketplacePost } from "@/lib/client/marketplace-client";
import styles from "./member-card-hour-assets.module.css";

type PaymentChannel = "ALIPAY" | "WXPAY";

type TopupRecord = {
  id: string;
  channel?: PaymentChannel | null;
  cardHourMicros: number;
  amountCents: number;
  status: "PROCESSING" | "PENDING" | "CAPTURED" | "CLOSED" | "RECONCILIATION_REQUIRED";
  createdAt: string;
  appealEligibility: { canAppeal: boolean; retryAt: string | null };
};

type AppealNotification = {
  caseNumber: string;
  topupOrderId: string;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED";
  resolutionNote: string | null;
  unread: boolean;
  updatedAt: string;
};

type CardHourDashboard = {
  rate: { cardHours: string; cny: string; topupBlockCardHours: string; topupBlockCny: string };
  balance: { availableMicros: number; heldMicros: number; lifetimeTopupMicros: number; lifetimeSpentMicros: number };
  income: { rentalVestedMicros: number; commissionVestedMicros: number };
  topups: TopupRecord[];
  appealNotifications: AppealNotification[];
  unreadAppealCount: number;
  topupAvailability: {
    ready: boolean;
    mode: "PILOT" | "CATALOG";
    reason: string | null;
    minCardHours: number;
    maxCardHours: number | null;
    stepCardHours: number;
    channels: Array<{ channel: PaymentChannel; ready: boolean; reason: string | null }>;
    packages: Array<{ code: string; name: string; cardHours: number; amountCents: number; description: string; badge?: string }>;
  };
};

type TopupCheckout = {
  record: TopupRecord;
  checkoutUrl: string;
  provider: "QIXIANG_PAY";
  channel: PaymentChannel;
  replayed: boolean;
};

const channelLabels: Record<PaymentChannel, string> = {
  ALIPAY: "支付宝",
  WXPAY: "微信支付",
};

const statusLabels: Record<TopupRecord["status"], string> = {
  PROCESSING: "付款单创建中",
  PENDING: "等待支付确认",
  CAPTURED: "已到账",
  CLOSED: "已关闭（未到账）",
  RECONCILIATION_REQUIRED: "待人工核对",
};
const appealStatusLabels: Record<AppealNotification["status"], string> = { OPEN: "已提交", UNDER_REVIEW: "人工核对中", RESOLVED: "已有处理结论", CLOSED: "已关闭" };

function money(cents: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function secureCheckoutUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("支付地址未通过安全检查，请稍后重试。");
  return url.toString();
}

export function MemberCardHourAssets() {
  const [dashboard, setDashboard] = useState<CardHourDashboard | null>(null);
  const [loadError, setLoadError] = useState("");
  const [cardHours, setCardHours] = useState("100");
  const [amountMode, setAmountMode] = useState<"PACKAGE" | "CUSTOM">("PACKAGE");
  const [channel, setChannel] = useState<PaymentChannel | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const idempotencyKey = useRef<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/v1/member/card-hours", { credentials: "same-origin", cache: "no-store", signal });
    const payload = await response.json().catch(() => null) as (CardHourDashboard & { error?: { message?: string } }) | null;
    if (!response.ok || !payload) throw new Error(payload?.error?.message ?? "卡时资产暂时无法读取。");
    setDashboard(payload);
    const firstPackage = payload.topupAvailability.packages[0];
    if (firstPackage) setCardHours(String(payload.topupAvailability.mode === "PILOT" ? firstPackage.cardHours : 500));
    setAmountMode("PACKAGE");
    const firstReady = payload.topupAvailability.channels.find((item) => item.ready)?.channel ?? null;
    setChannel((current) => payload.topupAvailability.channels.some((item) => item.ready && item.channel === current) ? current : firstReady);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => {
      load(controller.signal).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(error instanceof Error ? error.message : "卡时资产暂时无法读取。");
      });
    });
    return () => { window.cancelAnimationFrame(frame); controller.abort(); };
  }, [load]);

  const amount = Number(cardHours);
  const constraints = dashboard?.topupAvailability;
  const validAmount = Number.isSafeInteger(amount)
    && amount >= (constraints?.minCardHours ?? 5)
    && (constraints?.maxCardHours === null || constraints?.maxCardHours === undefined || amount <= constraints.maxCardHours)
    && amount % (constraints?.stepCardHours ?? 5) === 0;
  const amountCents = validAmount ? Math.round(amount * 100.2) : 0;
  const readyChannels = useMemo(() => dashboard?.topupAvailability.channels.filter((item) => item.ready) ?? [], [dashboard]);
  const appealByTopup = useMemo(() => new Map((dashboard?.appealNotifications ?? []).map((item) => [item.topupOrderId, item])), [dashboard]);

  async function createTopup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!dashboard?.topupAvailability.ready || !validAmount || !channel || !readyChannels.some((item) => item.channel === channel)) {
      setMessage(dashboard?.topupAvailability.reason || "请选择已开放的支付方式和有效卡时数量。");
      return;
    }
    setSubmitting(true);
    try {
      idempotencyKey.current ??= createIdempotencyKey(`card-hour-${channel.toLowerCase()}`);
      const result = await marketplacePost<TopupRecord, TopupCheckout>(
        "/api/v1/member/card-hours/topups",
        { cardHours, channel },
        idempotencyKey.current,
        20_000,
      );
      const checkoutUrl = secureCheckoutUrl(result.checkoutUrl);
      idempotencyKey.current = null;
      window.location.assign(checkoutUrl);
    } catch (error) {
      setMessage(marketplaceErrorMessage(error, error instanceof Error ? error.message : "付款单创建失败，请稍后重试。"));
      setSubmitting(false);
    }
  }

  if (loadError) return <section className={styles.returnPanel} role="alert"><h1>卡时资产读取失败</h1><p>{loadError}</p><button className={styles.secondaryAction} onClick={() => { setLoadError(""); void load().catch((error: unknown) => setLoadError(error instanceof Error ? error.message : "卡时资产暂时无法读取。")); }} type="button">重新读取</button></section>;
  if (!dashboard) return <div className={styles.returnPanel} role="status">正在读取当前组织的卡时资产…</div>;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div><p className={styles.eyebrow}>MY ASSETS</p><h1>我的资产 · 卡时账户</h1><p>充值人民币购买 KAI 标准卡时；网站资源仍只用卡时交易。</p></div>
        <dl className={styles.balance}><dt>可用 KAI 标准卡时</dt><dd>{formatCardHourDisplayMicros(dashboard.balance.availableMicros)}</dd></dl>
      </header>

      {dashboard.appealNotifications.length ? <section className={styles.panel} aria-labelledby="appeal-updates-title">
        <div className={styles.notificationHeading}><div><p className={styles.eyebrow}>APPEAL UPDATES</p><h2 id="appeal-updates-title">充值申诉进展</h2></div>{dashboard.unreadAppealCount > 0 ? <strong>{dashboard.unreadAppealCount} 条新进展</strong> : <span>最新处理状态</span>}</div>
        <div className={styles.notificationList}>{dashboard.appealNotifications.slice(0, 5).map((item) => <Link className={styles.notification} href={`/member/card-hours/topups/${encodeURIComponent(item.topupOrderId)}/appeal`} key={item.caseNumber}><span>{item.unread ? "未读" : appealStatusLabels[item.status]}</span><strong>{item.caseNumber}</strong><small>{appealStatusLabels[item.status]} · {dateTime(item.updatedAt)}</small>{item.resolutionNote ? <em>{item.resolutionNote}</em> : null}</Link>)}</div>
      </section> : null}

      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="asset-summary-title">
          <p className={styles.eyebrow}>ACCOUNT SUMMARY</p><h2 id="asset-summary-title">资产概览</h2>
          <div className={styles.metrics}>
            <div><span>已冻结</span><strong>{formatCardHourDisplayMicros(dashboard.balance.heldMicros)}</strong><small>KAI 标准卡时</small></div>
            <div><span>累计充值</span><strong>{formatCardHourDisplayMicros(dashboard.balance.lifetimeTopupMicros)}</strong><small>KAI 标准卡时</small></div>
            <div><span>累计使用</span><strong>{formatCardHourDisplayMicros(dashboard.balance.lifetimeSpentMicros)}</strong><small>KAI 标准卡时</small></div>
          </div>
          <p className={styles.notice}>创建付款单或从收银台返回，都不代表支付成功。只有平台服务端收到可信支付结果并完成卡时入账后，页面才会显示“已到账”。</p>
        </section>

        <form className={styles.panel} onSubmit={createTopup}>
          <p className={styles.eyebrow}>TOP UP CARD HOURS</p><h2>充值卡时</h2>
          <p className={styles.boundary}>人民币仅用于充值 KAI 标准卡时；站内算力资源只使用卡时交易。用户卡时不可提现、不可转账。</p>
          <div className={styles.amountMode} role="tablist" aria-label="充值数量选择方式">
            <button aria-selected={amountMode === "PACKAGE"} disabled={submitting || dashboard.topupAvailability.mode === "PILOT"} onClick={() => setAmountMode("PACKAGE")} role="tab" type="button">套餐充值</button>
            <button aria-selected={amountMode === "CUSTOM"} disabled={submitting || dashboard.topupAvailability.mode === "PILOT"} onClick={() => setAmountMode("CUSTOM")} role="tab" type="button">自定义充值</button>
          </div>
          {amountMode === "PACKAGE" ? <div className={styles.packages} aria-label="卡时充值套餐">{dashboard.topupAvailability.packages.map((item) => {
            const selected = cardHours === String(item.cardHours);
            return <button aria-pressed={selected} className={styles.package} disabled={submitting} key={item.code} onClick={() => { idempotencyKey.current = null; setCardHours(String(item.cardHours)); }} type="button">
              <span>{item.name}{item.badge ? <small>{item.badge}</small> : null}</span><strong>{item.cardHours.toFixed(2)} 卡时</strong><b>{money(item.amountCents)}</b><em>{item.description}</em>
            </button>;
          })}</div> : <label className={styles.field} htmlFor="member-card-hour-amount">充值卡时数量<input id="member-card-hour-amount" inputMode="numeric" min={dashboard.topupAvailability.minCardHours} max={dashboard.topupAvailability.maxCardHours ?? undefined} onChange={(event) => { idempotencyKey.current = null; setCardHours(event.target.value); }} step={dashboard.topupAvailability.stepCardHours} type="number" value={cardHours} /><small>最低 5.00 卡时，且必须为 5.00 的整数倍。</small></label>}
          {dashboard.topupAvailability.mode === "PILOT" ? <p className={styles.pilot}>当前为小额生产验收，仅支持充值 5.00 卡时。</p> : null}
          <fieldset className={styles.field}>
            <legend>选择支付渠道</legend>
            <div className={styles.channels}>{dashboard.topupAvailability.channels.map((item) => <button aria-pressed={channel === item.channel && item.ready} className={styles.channel} disabled={submitting || !item.ready} key={item.channel} onClick={() => { idempotencyKey.current = null; setChannel(item.channel); }} type="button"><strong>{channelLabels[item.channel]}</strong><small>{item.ready ? "已开放" : "暂未开放"}</small></button>)}</div>
            {!readyChannels.length ? <p className={styles.notice}>{dashboard.topupAvailability.reason ?? "支付渠道正在完成生产验收。"}</p> : null}
          </fieldset>
          <dl className={styles.summary}><div><dt>固定购买参考</dt><dd>1.00 卡时 = ¥1.002</dd></div><div><dt>到账卡时</dt><dd>{validAmount ? amount.toFixed(2) : "—"}</dd></div><div><dt>应付金额</dt><dd>{validAmount ? money(amountCents) : "—"}</dd></div></dl>
          {message ? <p className={styles.error} role="alert">{message}</p> : null}
          <button className={styles.primaryAction} disabled={submitting || !dashboard.topupAvailability.ready || !validAmount || !channel} type="submit">{submitting ? "正在创建付款单…" : "确认并前往支付"}</button>
          <p className={styles.notice}>创建付款单或从支付页返回均不代表到账，只有平台服务端确认后才会入账。当前不提供自助退款；充值异常由管理员人工核对处理。</p>
        </form>
      </div>

      <section className={styles.panel} aria-labelledby="topup-history-title">
        <p className={styles.eyebrow}>TOP-UP HISTORY</p><h2 id="topup-history-title">充值记录</h2>
        {dashboard.topups.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>付款单</th><th>支付方式</th><th>卡时</th><th>金额</th><th>状态</th><th>创建时间</th><th>处理</th></tr></thead><tbody>{dashboard.topups.map((record) => {
          const appeal = appealByTopup.get(record.id);
          return <tr key={record.id}><td data-label="付款单"><Link href={`/member/card-hours/topups/${encodeURIComponent(record.id)}/return`}>{record.id}</Link></td><td data-label="支付方式">{record.channel ? channelLabels[record.channel] : "历史付款单"}</td><td data-label="卡时">{formatCardHourDisplayMicros(record.cardHourMicros)}</td><td data-label="金额">{money(record.amountCents)}</td><td data-label="状态">{statusLabels[record.status] ?? "处理中"}</td><td data-label="创建时间">{dateTime(record.createdAt)}</td><td data-label="处理">{appeal ? <Link href={`/member/card-hours/topups/${encodeURIComponent(record.id)}/appeal`}>{appeal.unread ? "申诉有新进展" : `查看申诉 · ${appealStatusLabels[appeal.status]}`}</Link> : record.appealEligibility.canAppeal ? <Link href={`/member/card-hours/topups/${encodeURIComponent(record.id)}/appeal`}>充值遇到问题</Link> : record.appealEligibility.retryAt ? <small>可于 {dateTime(record.appealEligibility.retryAt)} 后申诉</small> : "—"}</td></tr>;
        })}</tbody></table></div> : <p>还没有充值记录。支付结果会按当前组织隔离显示。</p>}
      </section>
    </div>
  );
}
