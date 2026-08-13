"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createIdempotencyKey, marketplaceErrorMessage, marketplacePost } from "@/lib/client/marketplace-client";

type Dashboard = {
  rate: { cardHours: string; cny: string; topupBlockCardHours: string; topupBlockCny: string };
  balance: { availableMicros: number; heldMicros: number; lifetimeTopupMicros: number; lifetimeSpentMicros: number };
  topups: Array<{ id: string; cardHourMicros: number; amountCents: number; status: string; createdAt: string }>;
  purchases: Array<{ id: string; orderId: string; sourceSystem: string; amountMicros: number; cnyReferenceCents: number; status: string; createdAt: string }>;
  buybacks: Array<{ id: string; amount_micros?: number; status?: string; created_at?: string }>;
  income: { rentalPendingMicros: number; rentalVestedMicros: number; commissionPendingMicros: number; commissionVestedMicros: number };
  referral: { code: string; invitedOrganizations: number };
  topupAvailability: { ready: boolean; reason: string | null };
  ledger: Array<{ operation: string; business_key: string; account_code: "USER_AVAILABLE" | "USER_HELD"; side: string; amount_micros: number; balance_after_micros: number; created_at: string }>;
};

function cardHours(micros: number) {
  if (!Number.isSafeInteger(micros) || micros < 0) return "—";
  const whole = Math.floor(micros / 1_000_000);
  const fraction = String(micros % 1_000_000).padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function yuan(cents: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
}

function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const operationLabels: Record<string, string> = {
  TOPUP: "购买卡时", ORDER_CAPTURE: "购买算力", ORDER_REFUND: "订单退回", BUYBACK_HOLD: "回购锁定", BUYBACK_RELEASE: "回购释放", RENTAL_INCOME: "租金收益", COMMISSION_INCOME: "佣金收益", COMMISSION_REVERSAL: "佣金冲销",
};

export function CardHourAccountPanel() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState<false | "auth" | "error">(false);
  const [topup, setTopup] = useState("100");
  const [referralCode, setReferralCode] = useState("");
  const [busy, setBusy] = useState<"topup" | "referral" | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const topupKey = useRef<string | null>(null);

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

  async function buyCardHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dashboard?.topupAvailability.ready) {
      setMessage({ kind: "error", text: dashboard?.topupAvailability.reason || "人民币购买卡时尚未开放。" });
      return;
    }
    setBusy("topup"); setMessage(null);
    try {
      topupKey.current ??= createIdempotencyKey("card-hour-topup");
      const result = await marketplacePost<{ id: string }>("/api/v1/member/card-hours/topups", { cardHours: topup }, topupKey.current, 20_000) as { record: { id: string }; checkoutUrl?: string };
      topupKey.current = null;
      if (!result.checkoutUrl) throw new Error("支付地址暂时不可用。");
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      setMessage({ kind: "error", text: marketplaceErrorMessage(error, error instanceof Error ? error.message : "购买卡时暂时不可用。") });
      setBusy(null);
    }
  }

  async function attachReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("referral"); setMessage(null);
    try {
      await marketplacePost("/api/v1/member/card-hours/referral", { code: referralCode }, createIdempotencyKey("referral"));
      setMessage({ kind: "success", text: "邀请码已绑定。奖励会在有效订单完成并过退款观察期后成为可用卡时。" });
      setReferralCode(""); await load();
    } catch (error) { setMessage({ kind: "error", text: marketplaceErrorMessage(error, "邀请码绑定失败。") }); }
    finally { setBusy(null); }
  }

  if (failed === "auth") return <section className="mb-12 border-l-4 border-[var(--accent)] bg-[var(--info-bg)] p-5" id="card-hours"><h2 className="m-0 text-xl">登录后查看卡时账户</h2><p className="mb-0 mt-2 text-sm">余额、购买记录、回购、租金与佣金收益都按当前交易主体隔离。</p><a className="button button-primary mt-4 rounded-none" href="/login?returnTo=%2Fmember%23card-hours">登录并查看卡时账户</a></section>;
  if (failed === "error") return <section className="mb-12 border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-5" id="card-hours"><h2 className="m-0 text-xl">卡时账户暂时无法读取</h2><button className="button button-secondary mt-4 rounded-none" onClick={() => void load()} type="button">重新读取卡时账户</button></section>;
  if (!dashboard) return <section className="mb-12 border-l-2 border-[var(--accent)] pl-4" id="card-hours" role="status">正在读取卡时余额与账本…</section>;

  const topupNumber = Number(topup);
  const validTopup = Number.isInteger(topupNumber) && topupNumber >= 5 && topupNumber % 5 === 0;
  const payable = validTopup ? topupNumber * 1.002 : 0;
  const topupReady = dashboard.topupAvailability.ready;
  const cards = [
    ["可用卡时", cardHours(dashboard.balance.availableMicros), "可用于网站内全部资源支付"],
    ["已冻结", cardHours(dashboard.balance.heldMicros), "订单或回购处理中锁定"],
    ["累计购买", cardHours(dashboard.balance.lifetimeTopupMicros), "人民币验签成功后入账"],
    ["累计消费", cardHours(dashboard.balance.lifetimeSpentMicros), "资源成交实际扣减"],
    ["租金收益", cardHours(dashboard.income.rentalVestedMicros), `${cardHours(dashboard.income.rentalPendingMicros)} 卡时待结算`],
    ["佣金收益", cardHours(dashboard.income.commissionVestedMicros), `${cardHours(dashboard.income.commissionPendingMicros)} 卡时待生效`],
  ];

  return (
    <section className="mb-16 scroll-mt-28" id="card-hours" aria-labelledby="card-hour-title">
      <div className="border-t-4 border-[var(--accent)] bg-[var(--surface)] ring-1 ring-[var(--border)]">
        <header className="grid gap-6 border-b border-[var(--border)] p-6 lg:grid-cols-[1fr_360px] lg:items-end sm:p-8">
          <div><p className="kicker">KAI CREDIT HOUR</p><h2 className="m-0 text-3xl" id="card-hour-title">卡时账户</h2><p className="mb-0 mt-3 max-w-3xl text-sm text-[var(--muted)]">卡时是 KAI Cloud 的站内支付额度，与 GPU 物理卡时和 KAI-SCH 行情指数相互独立。网站资源只使用卡时结算。</p></div>
          <dl className="m-0 grid grid-cols-2 gap-px bg-[var(--border)] font-mono tabular-nums"><div className="bg-[var(--info-bg)] p-4"><dt className="text-xs text-[var(--muted)]">固定购买价</dt><dd className="m-0 mt-1 text-xl font-semibold text-[var(--ink)]">1 卡时</dd></div><div className="bg-[var(--info-bg)] p-4"><dt className="text-xs text-[var(--muted)]">人民币</dt><dd className="m-0 mt-1 text-xl font-semibold text-[var(--ink)]">¥1.002</dd></div></dl>
        </header>
        <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-6">{cards.map(([label, value, detail]) => <a className="bg-[var(--surface)] p-5 no-underline hover:bg-[var(--info-bg)]" href={label.includes("收益") ? "#income" : label === "可用卡时" ? "#topup" : "#card-hour-ledger"} key={label}><span className="text-xs font-semibold text-[var(--muted)]">{label}</span><strong className="mt-2 block font-mono text-2xl tabular-nums text-[var(--ink)]">{value}</strong><small className="mt-2 block leading-5 text-[var(--muted)]">{detail}</small></a>)}</div>
      </div>

      {message ? <div className={`mt-5 border-l-4 p-4 text-sm ${message.kind === "error" ? "border-[var(--error)] bg-[var(--error-bg)] text-[var(--error)]" : "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]"}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</div> : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <section className="bg-[var(--surface)] ring-1 ring-[var(--border)]" id="purchases" aria-labelledby="purchases-title"><div className="border-b border-[var(--border)] p-6"><p className="kicker">PURCHASES</p><h3 className="m-0 text-2xl" id="purchases-title">购买记录</h3></div>{dashboard.purchases.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead className="bg-[var(--info-bg)] text-xs text-[var(--muted)]"><tr><th className="p-4">订单</th><th className="p-4">状态</th><th className="p-4 text-right">卡时</th><th className="p-4 text-right">参考价</th></tr></thead><tbody>{dashboard.purchases.map((item) => <tr className="border-t border-[var(--border)]" key={item.id}><td className="p-4"><strong className="block text-[var(--ink)]">{item.orderId}</strong><small>{time(item.createdAt)}</small></td><td className="p-4">{item.status}</td><td className="p-4 text-right font-mono tabular-nums">{cardHours(item.amountMicros)}</td><td className="p-4 text-right font-mono tabular-nums">{yuan(item.cnyReferenceCents)}</td></tr>)}</tbody></table></div> : <p className="m-0 p-6 text-sm text-[var(--muted)]">还没有卡时支付记录。提交资源申请后，正式订单只会使用卡时支付。</p>}</section>

        <form className="h-fit bg-[var(--surface)] p-6 ring-1 ring-[var(--border)]" id="topup" onSubmit={buyCardHours}><p className="kicker">BUY CARD HOURS</p><h3 className="m-0 text-2xl">购买卡时</h3><p className="mt-3 text-sm text-[var(--muted)]">为避免人民币分币误差，购买数量必须是 5 卡时的整数倍；5 卡时正好是 ¥5.01。</p>{!topupReady ? <p className="border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-4 text-sm text-[var(--ink)]" role="status"><strong className="block">公开购买暂未开放</strong><span>{dashboard.topupAvailability.reason}</span></p> : null}<label className="mt-5 grid gap-2 text-sm font-semibold text-[var(--ink)]" htmlFor="card-hour-topup">卡时数量<input className="min-h-12 rounded-none border border-[var(--border-strong)] bg-[var(--canvas)] px-4 text-right font-mono tabular-nums" id="card-hour-topup" inputMode="numeric" min="5" onChange={(event) => setTopup(event.target.value)} step="5" type="number" value={topup} /></label><div className="mt-4 grid grid-cols-3 gap-px bg-[var(--border)]">{[100, 500, 1000].map((amount) => <button className="min-h-11 rounded-none border-0 bg-[var(--info-bg)] font-mono text-sm text-[var(--ink)] hover:bg-[var(--accent-soft)]" key={amount} onClick={() => setTopup(String(amount))} type="button">{amount}</button>)}</div><dl className="my-5 grid gap-px bg-[var(--border)]"><div className="flex justify-between bg-[var(--info-bg)] p-4"><dt>应付人民币</dt><dd className="m-0 font-mono font-semibold tabular-nums">{validTopup ? `¥${payable.toFixed(2)}` : "—"}</dd></div><div className="flex justify-between bg-[var(--info-bg)] p-4"><dt>到账卡时</dt><dd className="m-0 font-mono font-semibold tabular-nums">{validTopup ? topupNumber : "—"}</dd></div></dl><button className="button button-primary w-full rounded-none" disabled={!topupReady || !validTopup || busy !== null} type="submit">{busy === "topup" ? "正在创建付款单…" : topupReady ? "用人民币购买卡时" : "人民币购买尚未开放"}</button><p className="mb-0 mt-3 text-xs text-[var(--muted)]">只有支付服务端验签成功后才会入账；浏览器返回页面不代表购买成功。</p></form>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2" id="income"><section className="bg-[var(--surface)] p-6 ring-1 ring-[var(--border)]"><p className="kicker">INCOME</p><h3 className="m-0 text-2xl">租金与佣金收益</h3><div className="mt-5 grid grid-cols-2 gap-px bg-[var(--border)]"><div className="bg-[var(--info-bg)] p-5"><span className="text-xs text-[var(--muted)]">租金收益 · 可用</span><strong className="mt-2 block font-mono text-2xl text-[var(--ink)]">{cardHours(dashboard.income.rentalVestedMicros)}</strong><small>{cardHours(dashboard.income.rentalPendingMicros)} 待结算</small></div><div className="bg-[var(--info-bg)] p-5"><span className="text-xs text-[var(--muted)]">佣金收益 · 可用</span><strong className="mt-2 block font-mono text-2xl text-[var(--ink)]">{cardHours(dashboard.income.commissionVestedMicros)}</strong><small>{cardHours(dashboard.income.commissionPendingMicros)} 待生效</small></div></div><p className="mb-0 mt-4 text-xs text-[var(--muted)]">代理奖励暂按一级邀请记录为待生效；订单完成、验收并过退款观察期后才进入可用卡时，退款会产生冲销记录。</p></section>
        <section className="bg-[var(--surface)] p-6 ring-1 ring-[var(--border)]" id="referrals"><p className="kicker">REFERRALS</p><h3 className="m-0 text-2xl">邀请奖励</h3><dl className="mt-5 grid grid-cols-2 gap-px bg-[var(--border)]"><div className="bg-[var(--info-bg)] p-4"><dt className="text-xs text-[var(--muted)]">我的邀请码</dt><dd className="m-0 mt-1 font-mono font-semibold text-[var(--ink)]">{dashboard.referral.code}</dd></div><div className="bg-[var(--info-bg)] p-4"><dt className="text-xs text-[var(--muted)]">直接邀请主体</dt><dd className="m-0 mt-1 font-mono font-semibold text-[var(--ink)]">{dashboard.referral.invitedOrganizations}</dd></div></dl><form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={attachReferral}><label className="sr-only" htmlFor="referral-code">输入邀请码</label><input className="min-h-12 min-w-0 flex-1 rounded-none border border-[var(--border-strong)] bg-[var(--canvas)] px-4 font-mono uppercase" id="referral-code" maxLength={13} onChange={(event) => setReferralCode(event.target.value.toUpperCase())} placeholder="输入 KAI 邀请码" value={referralCode} /><button className="button button-secondary rounded-none" disabled={busy !== null || referralCode.length !== 13} type="submit">{busy === "referral" ? "正在绑定…" : "绑定邀请关系"}</button></form></section>
      </div>

      <section className="mt-8 bg-[var(--surface)] ring-1 ring-[var(--border)]" id="buybacks"><div className="border-b border-[var(--border)] p-6"><p className="kicker">BUYBACKS</p><h3 className="m-0 text-2xl">我的回购</h3></div>{dashboard.buybacks.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead className="bg-[var(--info-bg)] text-xs text-[var(--muted)]"><tr><th className="p-4">回购单</th><th className="p-4">状态</th><th className="p-4">申请时间</th><th className="p-4 text-right">卡时</th></tr></thead><tbody>{dashboard.buybacks.map((item) => <tr className="border-t border-[var(--border)]" key={item.id}><td className="p-4 font-mono text-xs">{item.id}</td><td className="p-4">{item.status ?? "—"}</td><td className="p-4">{item.created_at ? time(item.created_at) : "—"}</td><td className="p-4 text-right font-mono tabular-nums">{cardHours(item.amount_micros ?? 0)}</td></tr>)}</tbody></table></div> : <div className="border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-6"><strong className="text-[var(--ink)]">自动回购暂未开放</strong><p className="mb-0 mt-2 text-sm">回购价、手续费、单日限额和人民币出款审核尚未确定。面板已保留回购记录位，规则确定后采用“锁定卡时 → 审核 → 出款 → 扣减”的流程，不默认按购买价回购。</p></div>}</section>

      <section className="mt-8 bg-[var(--surface)] ring-1 ring-[var(--border)]" id="card-hour-ledger"><div className="border-b border-[var(--border)] p-6"><p className="kicker">LEDGER</p><h3 className="m-0 text-2xl">卡时明细</h3></div>{dashboard.ledger.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead className="bg-[var(--info-bg)] text-xs text-[var(--muted)]"><tr><th className="p-4">时间</th><th className="p-4">类型</th><th className="p-4">来源</th><th className="p-4 text-right">变动</th><th className="p-4 text-right">账户余额</th></tr></thead><tbody>{dashboard.ledger.map((item) => <tr className="border-t border-[var(--border)]" key={`${item.business_key}:${item.created_at}`}><td className="p-4 whitespace-nowrap">{time(item.created_at)}</td><td className="p-4">{operationLabels[item.operation] ?? item.operation}</td><td className="p-4 font-mono text-xs">{item.business_key}</td><td className="p-4 text-right font-mono tabular-nums">{item.side === "CREDIT" ? "+" : "−"}{cardHours(item.amount_micros)}</td><td className="p-4 text-right"><small className="block text-[var(--muted)]">{item.account_code === "USER_HELD" ? "冻结余额" : "可用余额"}</small><span className="font-mono tabular-nums">{cardHours(item.balance_after_micros)}</span></td></tr>)}</tbody></table></div> : <p className="m-0 p-6 text-sm text-[var(--muted)]">暂无卡时明细。所有充值、消费、退款和收益都会以不可修改的账本记录展示。</p>}</section>
    </section>
  );
}
