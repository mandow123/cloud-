"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createIdempotencyKey, marketplaceErrorMessage, marketplacePost } from "@/lib/client/marketplace-client";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";

type Dashboard = {
  balance: { availableMicros: number; heldMicros: number; lifetimeTopupMicros: number; lifetimeSpentMicros: number };
  topups: Array<{ id: string; cardHourMicros: number; amountCents: number; status: string; createdAt: string }>;
  purchases: Array<{ id: string; orderId: string; sourceSystem: string; amountMicros: number; status: string; createdAt: string }>;
  income: { rentalPendingMicros: number; rentalVestedMicros: number; commissionPendingMicros: number; commissionVestedMicros: number };
  referral: { code: string; invitedOrganizations: number };
  topupAvailability: { reason: string | null };
  ledger: Array<{ operation: string; business_key: string; account_code: "USER_AVAILABLE" | "USER_HELD"; side: string; amount_micros: number; balance_after_micros: number; created_at: string }>;
};

function cardHours(micros: number) {
  try { return formatCardHourDisplayMicros(micros); } catch { return "—"; }
}

function yuan(cents: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
}

function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const operationLabels: Record<string, string> = {
  TOPUP: "卡时充值",
  ORDER_CAPTURE: "购买算力",
  ORDER_REFUND: "订单退回",
  RENTAL_INCOME: "租金收益",
  COMMISSION_INCOME: "佣金收益",
  COMMISSION_REVERSAL: "佣金冲销",
};

export function CardHourAccountPanel() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState<false | "auth" | "error">(false);
  const [referralCode, setReferralCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/member/card-hours", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        setFailed(response.status === 401 ? "auth" : "error");
        return;
      }
      setDashboard(await response.json() as Dashboard);
      setFailed(false);
    } catch { setFailed("error"); }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  async function attachReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await marketplacePost("/api/v1/member/card-hours/referral", { code: referralCode }, createIdempotencyKey("referral"));
      setMessage({ kind: "success", text: "邀请码已绑定。奖励会在有效订单完成并过退款观察期后成为可用卡时。" });
      setReferralCode("");
      await load();
    } catch (error) {
      setMessage({ kind: "error", text: marketplaceErrorMessage(error, "邀请码绑定失败。") });
    } finally { setBusy(false); }
  }

  if (failed === "auth") return <section className="border-l-4 border-[var(--accent)] bg-[var(--info-bg)] p-5"><h2 className="m-0 text-xl">登录后查看我的资产</h2><p className="mb-0 mt-2 text-sm">卡时余额、明细与收益均按当前交易主体隔离。</p><a className="button button-primary mt-4 rounded-none" href="/login?returnTo=%2Fmember%2Fassets">登录并查看我的资产</a></section>;
  if (failed === "error") return <section className="border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-5"><h2 className="m-0 text-xl">资产账户暂时无法读取</h2><button className="button button-secondary mt-4 rounded-none" onClick={() => void load()} type="button">重新读取资产账户</button></section>;
  if (!dashboard) return <section className="border-l-2 border-[var(--accent)] pl-4" role="status">正在读取资产余额与账本…</section>;

  const cards = [
    ["可用卡时", cardHours(dashboard.balance.availableMicros), "可用于网站内资源支付", "#card-hour-ledger"],
    ["已冻结", cardHours(dashboard.balance.heldMicros), "订单处理中锁定", "#card-hour-ledger"],
    ["累计充值", cardHours(dashboard.balance.lifetimeTopupMicros), "已确认到账的卡时", "#topup"],
    ["累计消费", cardHours(dashboard.balance.lifetimeSpentMicros), "资源成交实际扣减", "#purchases"],
    ["租金收益", cardHours(dashboard.income.rentalVestedMicros), `${cardHours(dashboard.income.rentalPendingMicros)} 卡时待结算`, "#income"],
    ["佣金收益", cardHours(dashboard.income.commissionVestedMicros), `${cardHours(dashboard.income.commissionPendingMicros)} 卡时待生效`, "#income"],
  ];

  return (
    <div className="grid gap-10">
      <section className="scroll-mt-28" id="asset-overview" aria-labelledby="asset-overview-title">
        <div className="border-t-4 border-[var(--accent)] bg-[var(--surface)] ring-1 ring-[var(--border)]">
          <header className="border-b border-[var(--border)] p-6 sm:p-8">
            <p className="kicker">ASSET OVERVIEW</p>
            <h2 className="m-0 text-3xl" id="asset-overview-title">资产总览</h2>
            <p className="mb-0 mt-3 max-w-3xl text-sm text-[var(--muted)]">这里直接读取现有卡时账户与不可变账本。KAI 标准卡时是站内支付额度，不等同于 GPU 物理卡时或行情指数。</p>
          </header>
          <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-6">
            {cards.map(([label, value, detail, href]) => <a className="bg-[var(--surface)] p-5 no-underline hover:bg-[var(--info-bg)]" href={href} key={label}><span className="text-xs font-semibold text-[var(--muted)]">{label}</span><strong className="mt-2 block font-mono text-2xl tabular-nums text-[var(--ink)]">{value}</strong><small className="mt-2 block leading-5 text-[var(--muted)]">{detail}</small></a>)}
          </div>
        </div>
      </section>

      <section className="scroll-mt-28" id="card-hour-ledger" aria-labelledby="card-hour-ledger-title">
        <div className="border-t-4 border-[var(--accent)] bg-[var(--surface)] ring-1 ring-[var(--border)]">
          <header className="border-b border-[var(--border)] p-6"><p className="kicker">CARD HOUR LEDGER</p><h2 className="m-0 text-2xl" id="card-hour-ledger-title">卡时明细</h2></header>
          {dashboard.ledger.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead className="bg-[var(--info-bg)] text-xs text-[var(--muted)]"><tr><th className="p-4">时间</th><th className="p-4">类型</th><th className="p-4">来源</th><th className="p-4 text-right">变动卡时</th><th className="p-4 text-right">账户余额</th></tr></thead><tbody>{dashboard.ledger.map((item) => <tr className="border-t border-[var(--border)]" key={`${item.business_key}:${item.created_at}`}><td className="p-4 whitespace-nowrap">{time(item.created_at)}</td><td className="p-4">{operationLabels[item.operation] ?? item.operation}</td><td className="p-4 font-mono text-xs">{item.business_key}</td><td className="p-4 text-right font-mono tabular-nums">{item.side === "CREDIT" ? "+" : "−"}{cardHours(item.amount_micros)}</td><td className="p-4 text-right"><small className="block text-[var(--muted)]">{item.account_code === "USER_HELD" ? "冻结余额" : "可用余额"}</small><span className="font-mono tabular-nums">{cardHours(item.balance_after_micros)}</span></td></tr>)}</tbody></table></div> : <p className="m-0 p-6 text-sm text-[var(--muted)]">暂无卡时明细。充值、消费、退款和收益会以不可修改的账本记录展示。</p>}
        </div>
        <div className="mt-8 bg-[var(--surface)] ring-1 ring-[var(--border)]" id="purchases">
          <header className="border-b border-[var(--border)] p-6"><p className="kicker">PURCHASES</p><h3 className="m-0 text-2xl">购买记录</h3></header>
          {dashboard.purchases.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead className="bg-[var(--info-bg)] text-xs text-[var(--muted)]"><tr><th className="p-4">订单</th><th className="p-4">状态</th><th className="p-4 text-right">支付卡时</th></tr></thead><tbody>{dashboard.purchases.map((item) => <tr className="border-t border-[var(--border)]" key={item.id}><td className="p-4"><strong className="block text-[var(--ink)]">{item.orderId}</strong><small>{time(item.createdAt)}</small></td><td className="p-4">{item.status}</td><td className="p-4 text-right font-mono tabular-nums">{cardHours(item.amountMicros)}</td></tr>)}</tbody></table></div> : <p className="m-0 p-6 text-sm text-[var(--muted)]">还没有卡时支付记录。正式资源订单只使用卡时支付。</p>}
        </div>
      </section>

      <section className="scroll-mt-28" id="income" aria-labelledby="income-title">
        <header className="border-b border-[var(--border)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)]"><p className="kicker">INCOME</p><h2 className="m-0 text-2xl" id="income-title">收益</h2></header>
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="bg-[var(--surface)] p-6 ring-1 ring-[var(--border)]"><h3 className="m-0 text-xl">租金与佣金</h3><div className="mt-5 grid grid-cols-2 gap-px bg-[var(--border)]"><div className="bg-[var(--info-bg)] p-5"><span className="text-xs text-[var(--muted)]">租金 · 可用卡时</span><strong className="mt-2 block font-mono text-2xl text-[var(--ink)]">{cardHours(dashboard.income.rentalVestedMicros)}</strong><small>{cardHours(dashboard.income.rentalPendingMicros)} 卡时待结算</small></div><div className="bg-[var(--info-bg)] p-5"><span className="text-xs text-[var(--muted)]">佣金 · 可用卡时</span><strong className="mt-2 block font-mono text-2xl text-[var(--ink)]">{cardHours(dashboard.income.commissionVestedMicros)}</strong><small>{cardHours(dashboard.income.commissionPendingMicros)} 卡时待生效</small></div></div><p className="mb-0 mt-4 text-xs text-[var(--muted)]">有效订单完成、验收并过退款观察期后，收益才进入可用卡时；退款会产生冲销记录。</p></div>
          <div className="bg-[var(--surface)] p-6 ring-1 ring-[var(--border)]" id="referrals"><h3 className="m-0 text-xl">邀请奖励</h3><dl className="mt-5 grid grid-cols-2 gap-px bg-[var(--border)]"><div className="bg-[var(--info-bg)] p-4"><dt className="text-xs text-[var(--muted)]">我的邀请码</dt><dd className="m-0 mt-1 font-mono font-semibold text-[var(--ink)]">{dashboard.referral.code}</dd></div><div className="bg-[var(--info-bg)] p-4"><dt className="text-xs text-[var(--muted)]">直接邀请主体</dt><dd className="m-0 mt-1 font-mono font-semibold text-[var(--ink)]">{dashboard.referral.invitedOrganizations}</dd></div></dl><form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={attachReferral}><label className="sr-only" htmlFor="referral-code">输入邀请码</label><input className="min-h-12 min-w-0 flex-1 rounded-none border border-[var(--border-strong)] bg-[var(--canvas)] px-4 font-mono uppercase" id="referral-code" maxLength={13} onChange={(event) => setReferralCode(event.target.value.toUpperCase())} placeholder="输入 KAI 邀请码" value={referralCode} /><button className="button button-secondary rounded-none" disabled={busy || referralCode.length !== 13} type="submit">{busy ? "正在绑定…" : "绑定邀请关系"}</button></form></div>
        </div>
        {message ? <div className={`mt-5 border-l-4 p-4 text-sm ${message.kind === "error" ? "border-[var(--error)] bg-[var(--error-bg)] text-[var(--error)]" : "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]"}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</div> : null}
      </section>

      <section className="scroll-mt-28 border-t-4 border-[var(--warning)] bg-[var(--surface)] ring-1 ring-[var(--border)]" id="topup" aria-labelledby="topup-title">
        <header className="border-b border-[var(--border)] p-6 sm:p-8"><p className="kicker">CARD HOUR TOP-UP</p><h2 className="m-0 text-2xl" id="topup-title">卡时充值</h2><p className="mb-0 mt-3 text-sm text-[var(--muted)]">固定换算：<strong className="text-[var(--ink)]">1.00 KAI 标准卡时 = ¥1.002</strong></p></header>
        <div className="grid gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] sm:p-8">
          <div><div className="border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-5" role="status"><strong className="block text-[var(--ink)]">充值服务当前关闭</strong><code className="mt-2 block text-sm text-[var(--warning)]">TOPUP_CLOSED</code><p className="mb-0 mt-2 text-sm">{dashboard.topupAvailability.reason?.trim() || "支付通道和服务端验签尚未开放。"}</p></div><p className="mb-0 mt-4 text-xs text-[var(--muted)]">关闭期间不展示充值数量输入、快捷金额或支付按钮，也不会在浏览器中生成付款单。</p></div>
          <div><h3 className="m-0 text-lg">充值记录</h3>{dashboard.topups.length ? <div className="mt-4 overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead className="bg-[var(--info-bg)] text-xs text-[var(--muted)]"><tr><th className="p-3">时间</th><th className="p-3">状态</th><th className="p-3 text-right">到账卡时</th><th className="p-3 text-right">人民币</th></tr></thead><tbody>{dashboard.topups.map((item) => <tr className="border-t border-[var(--border)]" key={item.id}><td className="p-3 whitespace-nowrap">{time(item.createdAt)}</td><td className="p-3">{item.status}</td><td className="p-3 text-right font-mono tabular-nums">{cardHours(item.cardHourMicros)}</td><td className="p-3 text-right font-mono tabular-nums">{yuan(item.amountCents)}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-[var(--muted)]">暂无充值记录。</p>}</div>
        </div>
      </section>
    </div>
  );
}
