"use client";

import { type FormEvent, useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { createIdempotencyKey, MarketplaceApiError, marketplacePost } from "@/lib/client/marketplace-client";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";
import { BusinessValue, localizeNode as localizeFixedNode } from "@/components/render-time-localization";

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

const EN: Record<string, string> = {
  "购买卡时": "Buy card hours", "购买算力": "Buy compute", "订单退回": "Order refund", "回购锁定": "Buyback hold", "回购释放": "Buyback release", "租金收益": "Rental income", "佣金收益": "Commission income", "佣金冲销": "Commission reversal",
  "邀请码已绑定。奖励会在有效订单完成并过退款观察期后成为可用卡时。": "Referral code linked. Rewards become available card hours after an eligible order is completed and clears the refund observation period.", "邀请码绑定失败。": "Could not link the referral code.", "请求编号": "Request ID",
  "登录后查看卡时账户": "Sign in to view your card-hour account", "余额、购买记录、回购、租金与佣金收益都按当前交易主体隔离。": "Balances, purchases, buybacks, rental income, and commission income are isolated by the active trading entity.", "登录并查看卡时账户": "Sign in and view card-hour account", "卡时账户暂时无法读取": "Card-hour account is temporarily unavailable", "重新读取卡时账户": "Reload card-hour account", "正在读取卡时余额与账本…": "Loading card-hour balance and ledger…",
  "可用卡时": "Available card hours", "可用于网站内全部资源支付": "Available for all resource payments on the site", "已冻结": "Held", "订单或回购处理中锁定": "Locked while an order or buyback is processing", "累计购买": "Lifetime purchases", "人民币验签成功后入账": "Credited after CNY payment verification", "累计消费": "Lifetime spent", "资源成交实际扣减": "Actual deduction for completed resource transactions", "卡时待结算": "card hours pending settlement", "卡时待生效": "card hours pending activation",
  "卡时账户": "Card-hour account", "卡时是 KAI Cloud 的站内支付额度，与 GPU 物理卡时和 KAI-SCH 行情指数相互独立。网站资源只使用卡时结算。": "Card hours are KAI Cloud’s internal payment credit, separate from physical GPU hours and the KAI-SCH index. Site resources settle only in card hours.", "固定购买价": "Fixed purchase price", "人民币": "CNY", "卡时": "card hours",
  "1.00 卡时": "1.00 card hours",
  "购买记录": "Purchase history", "订单": "Order", "状态": "Status", "参考价": "Reference price", "还没有卡时支付记录。提交资源申请后，正式订单只会使用卡时支付。": "There are no card-hour payment records. Formal orders use only card hours after a resource request is submitted.",
  "充值卡时": "Top up card hours", "充值数量、支付渠道和真实到账状态统一在“我的资产”中管理。旧版个人中心不再直接创建付款单。": "Top-up amount, payment channel, and confirmed receipt are managed in My Assets. This legacy member page no longer creates payment orders directly.", "进入我的资产 / 充值卡时": "Open My Assets / top up", "创建付款单或从支付页面返回都不代表充值成功；卡时只在服务端确认并入账后显示。": "Creating a payment order or returning from the payment page does not prove success. Card hours appear only after server confirmation and posting.",
  "租金与佣金收益": "Rental and commission income", "租金收益 · 可用": "Rental income · available", "佣金收益 · 可用": "Commission income · available", "待结算": "pending settlement", "待生效": "pending activation", "代理奖励暂按一级邀请记录为待生效；订单完成、验收并过退款观察期后才进入可用卡时，退款会产生冲销记录。": "Referral rewards remain pending for direct invitations and become available card hours only after order completion, acceptance, and the refund observation period. Refunds create reversal entries.",
  "邀请奖励": "Referral rewards", "我的邀请码": "My referral code", "直接邀请主体": "Directly invited entities", "输入邀请码": "Enter referral code", "输入 KAI 邀请码": "Enter KAI referral code", "正在绑定…": "Linking…", "绑定邀请关系": "Link referral",
  "我的回购": "My buybacks", "回购单": "Buyback", "申请时间": "Requested at", "自动回购暂未开放": "Automatic buyback is not available", "回购价、手续费、单日限额和人民币出款审核尚未确定。面板已保留回购记录位，规则确定后采用“锁定卡时 → 审核 → 出款 → 扣减”的流程，不默认按购买价回购。": "Buyback price, fees, daily limits, and CNY payout review are not finalized. The panel reserves buyback records; once rules are approved, the flow will be hold card hours → review → payout → deduct, without assuming repurchase at purchase price.",
  "卡时明细": "Card-hour ledger", "时间": "Time", "类型": "Type", "来源": "Source", "变动": "Change", "账户余额": "Account balance", "冻结余额": "Held balance", "可用余额": "Available balance", "暂无卡时明细。所有充值、消费、退款和收益都会以不可修改的账本记录展示。": "No card-hour entries yet. Top-ups, spending, refunds, and income appear as immutable ledger records.",
};
const CORE: Record<Exclude<Locale, "zh-CN" | "en">, Record<string, string>> = {
  "zh-TW": { "卡时账户": "卡時帳戶", "购买记录": "購買記錄", "充值卡时": "充值卡時", "邀请奖励": "邀請獎勵", "我的回购": "我的回購", "卡时明细": "卡時明細" },
  ja: { "卡时账户": "カード時間口座", "购买记录": "購入履歴", "充值卡时": "カード時間をチャージ", "邀请奖励": "紹介特典", "我的回购": "買い戻し", "卡时明细": "カード時間明細" },
  ko: { "卡时账户": "카드시간 계정", "购买记录": "구매 내역", "充值卡时": "카드시간 충전", "邀请奖励": "추천 보상", "我的回购": "내 바이백", "卡时明细": "카드시간 원장" },
  fr: { "卡时账户": "Compte d’heures-carte", "购买记录": "Historique d’achat", "充值卡时": "Recharger des heures-carte", "邀请奖励": "Récompenses de parrainage", "我的回购": "Mes rachats", "卡时明细": "Registre d’heures-carte" },
  th: { "卡时账户": "บัญชีชั่วโมงการ์ด", "购买记录": "ประวัติการซื้อ", "充值卡时": "เติมชั่วโมงการ์ด", "邀请奖励": "รางวัลแนะนำ", "我的回购": "การซื้อคืนของฉัน", "卡时明细": "บัญชีชั่วโมงการ์ด" },
  vi: { "卡时账户": "Tài khoản giờ-thẻ", "购买记录": "Lịch sử mua", "充值卡时": "Nạp giờ-thẻ", "邀请奖励": "Thưởng giới thiệu", "我的回购": "Mua lại của tôi", "卡时明细": "Sổ giờ-thẻ" },
  id: { "卡时账户": "Akun jam-kartu", "购买记录": "Riwayat pembelian", "充值卡时": "Isi ulang jam-kartu", "邀请奖励": "Hadiah referal", "我的回购": "Buyback saya", "卡时明细": "Buku besar jam-kartu" },
  ms: { "卡时账户": "Akaun jam-kad", "购买记录": "Sejarah pembelian", "充值卡时": "Tambah nilai jam-kad", "邀请奖励": "Ganjaran rujukan", "我的回购": "Pembelian balik saya", "卡时明细": "Lejar jam-kad" },
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

function safeError(locale: Locale, error: unknown, fallback: string) {
  const requestId = error instanceof MarketplaceApiError ? error.requestId : undefined;
  return `${localizeText(locale, fallback)}${requestId ? ` (${localizeText(locale, "请求编号")}: ${requestId})` : ""}`;
}

function cardHours(micros: number) {
  try { return formatCardHourDisplayMicros(micros); } catch { return "—"; }
}

function yuan(cents: number, locale: Locale) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "CNY" }).format(cents / 100);
}

function time(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const operationLabels: Record<string, string> = {
  TOPUP: "购买卡时", ORDER_CAPTURE: "购买算力", ORDER_REFUND: "订单退回", BUYBACK_HOLD: "回购锁定", BUYBACK_RELEASE: "回购释放", RENTAL_INCOME: "租金收益", COMMISSION_INCOME: "佣金收益", COMMISSION_REVERSAL: "佣金冲销",
};

export function CardHourAccountPanel() {
  const { locale } = useLocale();
  const render = (node: ReactNode) => localizeNode(locale, node) as ReactElement;
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState<false | "auth" | "error">(false);
  const [referralCode, setReferralCode] = useState("");
  const [busy, setBusy] = useState<"referral" | null>(null);
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
    event.preventDefault(); setBusy("referral"); setMessage(null);
    try {
      await marketplacePost("/api/v1/member/card-hours/referral", { code: referralCode }, createIdempotencyKey("referral"));
      setMessage({ kind: "success", text: localizeText(locale, "邀请码已绑定。奖励会在有效订单完成并过退款观察期后成为可用卡时。") });
      setReferralCode(""); await load();
    } catch (error) { setMessage({ kind: "error", text: safeError(locale, error, "邀请码绑定失败。") }); }
    finally { setBusy(null); }
  }

  if (failed === "auth") return render(<section className="mb-12 border-l-4 border-[var(--accent)] bg-[var(--info-bg)] p-5" id="card-hours"><h2 className="m-0 text-xl">登录后查看卡时账户</h2><p className="mb-0 mt-2 text-sm">余额、购买记录、回购、租金与佣金收益都按当前交易主体隔离。</p><a className="button button-primary mt-4 rounded-none" href="/login?returnTo=%2Fmember%23card-hours">登录并查看卡时账户</a></section>);
  if (failed === "error") return render(<section className="mb-12 border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-5" id="card-hours"><h2 className="m-0 text-xl">卡时账户暂时无法读取</h2><button className="button button-secondary mt-4 rounded-none" onClick={() => void load()} type="button">重新读取卡时账户</button></section>);
  if (!dashboard) return render(<section className="mb-12 border-l-2 border-[var(--accent)] pl-4" id="card-hours" role="status">正在读取卡时余额与账本…</section>);

  const cards: Array<[string, ReactNode, ReactNode]> = [
    ["可用卡时", <BusinessValue key="available">{cardHours(dashboard.balance.availableMicros)}</BusinessValue>, "可用于网站内全部资源支付"],
    ["已冻结", <BusinessValue key="held">{cardHours(dashboard.balance.heldMicros)}</BusinessValue>, "订单或回购处理中锁定"],
    ["累计购买", <BusinessValue key="topup">{cardHours(dashboard.balance.lifetimeTopupMicros)}</BusinessValue>, "人民币验签成功后入账"],
    ["累计消费", <BusinessValue key="spent">{cardHours(dashboard.balance.lifetimeSpentMicros)}</BusinessValue>, "资源成交实际扣减"],
    ["租金收益", <BusinessValue key="rental-vested">{cardHours(dashboard.income.rentalVestedMicros)}</BusinessValue>, <><BusinessValue>{cardHours(dashboard.income.rentalPendingMicros)}</BusinessValue> 卡时待结算</>],
    ["佣金收益", <BusinessValue key="commission-vested">{cardHours(dashboard.income.commissionVestedMicros)}</BusinessValue>, <><BusinessValue>{cardHours(dashboard.income.commissionPendingMicros)}</BusinessValue> 卡时待生效</>],
  ];

  return render(
    <section className="mb-16 scroll-mt-28" id="card-hours" aria-labelledby="card-hour-title">
      <div className="border-t-4 border-[var(--accent)] bg-[var(--surface)] ring-1 ring-[var(--border)]">
        <header className="grid gap-6 border-b border-[var(--border)] p-6 lg:grid-cols-[1fr_360px] lg:items-end sm:p-8">
          <div><p className="kicker">KAI CREDIT HOUR</p><h2 className="m-0 text-3xl" id="card-hour-title">卡时账户</h2><p className="mb-0 mt-3 max-w-3xl text-sm text-[var(--muted)]">卡时是 KAI Cloud 的站内支付额度，与 GPU 物理卡时和 KAI-SCH 行情指数相互独立。网站资源只使用卡时结算。</p></div>
          <dl className="m-0 grid grid-cols-2 gap-px bg-[var(--border)] font-mono tabular-nums"><div className="bg-[var(--info-bg)] p-4"><dt className="text-xs text-[var(--muted)]">固定购买价</dt><dd className="m-0 mt-1 text-xl font-semibold text-[var(--ink)]">1.00 卡时</dd></div><div className="bg-[var(--info-bg)] p-4"><dt className="text-xs text-[var(--muted)]">人民币</dt><dd className="m-0 mt-1 text-xl font-semibold text-[var(--ink)]">¥1.002</dd></div></dl>
        </header>
        <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-6">{cards.map(([label, value, detail]) => <a className="bg-[var(--surface)] p-5 no-underline hover:bg-[var(--info-bg)]" href={label.includes("收益") ? "#income" : label === "可用卡时" ? "#topup" : "#card-hour-ledger"} key={label}><span className="text-xs font-semibold text-[var(--muted)]">{label}</span><strong className="mt-2 block font-mono text-2xl tabular-nums text-[var(--ink)]">{value}</strong><small className="mt-2 block leading-5 text-[var(--muted)]">{detail}</small></a>)}</div>
      </div>

      {message ? <div className={`mt-5 border-l-4 p-4 text-sm ${message.kind === "error" ? "border-[var(--error)] bg-[var(--error-bg)] text-[var(--error)]" : "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]"}`} role={message.kind === "error" ? "alert" : "status"}><BusinessValue>{message.text}</BusinessValue></div> : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <section className="bg-[var(--surface)] ring-1 ring-[var(--border)]" id="purchases" aria-labelledby="purchases-title"><div className="border-b border-[var(--border)] p-6"><p className="kicker">PURCHASES</p><h3 className="m-0 text-2xl" id="purchases-title">购买记录</h3></div>{dashboard.purchases.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead className="bg-[var(--info-bg)] text-xs text-[var(--muted)]"><tr><th className="p-4">订单</th><th className="p-4">状态</th><th className="p-4 text-right">卡时</th><th className="p-4 text-right">参考价</th></tr></thead><tbody>{dashboard.purchases.map((item) => <tr className="border-t border-[var(--border)]" key={item.id}><td className="p-4"><strong className="block text-[var(--ink)]"><BusinessValue>{item.orderId}</BusinessValue></strong><small><BusinessValue>{time(item.createdAt, locale)}</BusinessValue></small></td><td className="p-4"><BusinessValue>{item.status}</BusinessValue></td><td className="p-4 text-right font-mono tabular-nums"><BusinessValue>{cardHours(item.amountMicros)}</BusinessValue></td><td className="p-4 text-right font-mono tabular-nums"><BusinessValue>{yuan(item.cnyReferenceCents, locale)}</BusinessValue></td></tr>)}</tbody></table></div> : <p className="m-0 p-6 text-sm text-[var(--muted)]">还没有卡时支付记录。提交资源申请后，正式订单只会使用卡时支付。</p>}</section>

        <section className="h-fit bg-[var(--surface)] p-6 ring-1 ring-[var(--border)]" id="topup"><p className="kicker">TOP UP CARD HOURS</p><h3 className="m-0 text-2xl">充值卡时</h3><p className="mt-3 text-sm text-[var(--muted)]">充值数量、支付渠道和真实到账状态统一在“我的资产”中管理。旧版个人中心不再直接创建付款单。</p><a className="button button-primary mt-5 w-full rounded-none" href="/member/card-hours">进入我的资产 / 充值卡时</a><p className="mb-0 mt-3 text-xs text-[var(--muted)]">创建付款单或从支付页面返回都不代表充值成功；卡时只在服务端确认并入账后显示。</p></section>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2" id="income"><section className="bg-[var(--surface)] p-6 ring-1 ring-[var(--border)]"><p className="kicker">INCOME</p><h3 className="m-0 text-2xl">租金与佣金收益</h3><div className="mt-5 grid grid-cols-2 gap-px bg-[var(--border)]"><div className="bg-[var(--info-bg)] p-5"><span className="text-xs text-[var(--muted)]">租金收益 · 可用</span><strong className="mt-2 block font-mono text-2xl text-[var(--ink)]"><BusinessValue>{cardHours(dashboard.income.rentalVestedMicros)}</BusinessValue></strong><small><BusinessValue>{cardHours(dashboard.income.rentalPendingMicros)}</BusinessValue> 待结算</small></div><div className="bg-[var(--info-bg)] p-5"><span className="text-xs text-[var(--muted)]">佣金收益 · 可用</span><strong className="mt-2 block font-mono text-2xl text-[var(--ink)]"><BusinessValue>{cardHours(dashboard.income.commissionVestedMicros)}</BusinessValue></strong><small><BusinessValue>{cardHours(dashboard.income.commissionPendingMicros)}</BusinessValue> 待生效</small></div></div><p className="mb-0 mt-4 text-xs text-[var(--muted)]">代理奖励暂按一级邀请记录为待生效；订单完成、验收并过退款观察期后才进入可用卡时，退款会产生冲销记录。</p></section>
        <section className="bg-[var(--surface)] p-6 ring-1 ring-[var(--border)]" id="referrals"><p className="kicker">REFERRALS</p><h3 className="m-0 text-2xl">邀请奖励</h3><dl className="mt-5 grid grid-cols-2 gap-px bg-[var(--border)]"><div className="bg-[var(--info-bg)] p-4"><dt className="text-xs text-[var(--muted)]">我的邀请码</dt><dd className="m-0 mt-1 font-mono font-semibold text-[var(--ink)]"><BusinessValue>{dashboard.referral.code}</BusinessValue></dd></div><div className="bg-[var(--info-bg)] p-4"><dt className="text-xs text-[var(--muted)]">直接邀请主体</dt><dd className="m-0 mt-1 font-mono font-semibold text-[var(--ink)]"><BusinessValue>{dashboard.referral.invitedOrganizations}</BusinessValue></dd></div></dl><form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={attachReferral}><label className="sr-only" htmlFor="referral-code">输入邀请码</label><input className="min-h-12 min-w-0 flex-1 rounded-none border border-[var(--border-strong)] bg-[var(--canvas)] px-4 font-mono uppercase" id="referral-code" maxLength={13} onChange={(event) => setReferralCode(event.target.value.toUpperCase())} placeholder="输入 KAI 邀请码" value={referralCode} /><button className="button button-secondary rounded-none" disabled={busy !== null || referralCode.length !== 13} type="submit">{busy === "referral" ? "正在绑定…" : "绑定邀请关系"}</button></form></section>
      </div>

      <section className="mt-8 bg-[var(--surface)] ring-1 ring-[var(--border)]" id="buybacks"><div className="border-b border-[var(--border)] p-6"><p className="kicker">BUYBACKS</p><h3 className="m-0 text-2xl">我的回购</h3></div>{dashboard.buybacks.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead className="bg-[var(--info-bg)] text-xs text-[var(--muted)]"><tr><th className="p-4">回购单</th><th className="p-4">状态</th><th className="p-4">申请时间</th><th className="p-4 text-right">卡时</th></tr></thead><tbody>{dashboard.buybacks.map((item) => <tr className="border-t border-[var(--border)]" key={item.id}><td className="p-4 font-mono text-xs"><BusinessValue>{item.id}</BusinessValue></td><td className="p-4"><BusinessValue>{item.status ?? "—"}</BusinessValue></td><td className="p-4"><BusinessValue>{item.created_at ? time(item.created_at, locale) : "—"}</BusinessValue></td><td className="p-4 text-right font-mono tabular-nums"><BusinessValue>{cardHours(item.amount_micros ?? 0)}</BusinessValue></td></tr>)}</tbody></table></div> : <div className="border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-6"><strong className="text-[var(--ink)]">自动回购暂未开放</strong><p className="mb-0 mt-2 text-sm">回购价、手续费、单日限额和人民币出款审核尚未确定。面板已保留回购记录位，规则确定后采用“锁定卡时 → 审核 → 出款 → 扣减”的流程，不默认按购买价回购。</p></div>}</section>

      <section className="mt-8 bg-[var(--surface)] ring-1 ring-[var(--border)]" id="card-hour-ledger"><div className="border-b border-[var(--border)] p-6"><p className="kicker">LEDGER</p><h3 className="m-0 text-2xl">卡时明细</h3></div>{dashboard.ledger.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead className="bg-[var(--info-bg)] text-xs text-[var(--muted)]"><tr><th className="p-4">时间</th><th className="p-4">类型</th><th className="p-4">来源</th><th className="p-4 text-right">变动</th><th className="p-4 text-right">账户余额</th></tr></thead><tbody>{dashboard.ledger.map((item) => <tr className="border-t border-[var(--border)]" key={`${item.business_key}:${item.created_at}`}><td className="p-4 whitespace-nowrap"><BusinessValue>{time(item.created_at, locale)}</BusinessValue></td><td className="p-4">{operationLabels[item.operation] ?? <BusinessValue>{item.operation}</BusinessValue>}</td><td className="p-4 font-mono text-xs"><BusinessValue>{item.business_key}</BusinessValue></td><td className="p-4 text-right font-mono tabular-nums"><BusinessValue>{item.side === "CREDIT" ? "+" : "−"}{cardHours(item.amount_micros)}</BusinessValue></td><td className="p-4 text-right"><small className="block text-[var(--muted)]">{item.account_code === "USER_HELD" ? "冻结余额" : "可用余额"}</small><span className="font-mono tabular-nums"><BusinessValue>{cardHours(item.balance_after_micros)}</BusinessValue></span></td></tr>)}</tbody></table></div> : <p className="m-0 p-6 text-sm text-[var(--muted)]">暂无卡时明细。所有充值、消费、退款和收益都会以不可修改的账本记录展示。</p>}</section>
    </section>
  );
}
