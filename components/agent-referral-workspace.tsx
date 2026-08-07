"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommissionAccrual, ReferralAttribution, ReferralCode } from "@/lib/exchange";
import { createIdempotencyKey, exchangeGet, exchangePost, marketplaceErrorMessage } from "@/lib/client/marketplace-client";

type ListResponse<T> = { items: T[]; count: number };

function money(cents: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
}

export function AgentReferralWorkspace() {
  const [codes, setCodes] = useState<ReferralCode[]>([]);
  const [attributions, setAttributions] = useState<ReferralAttribution[]>([]);
  const [commissions, setCommissions] = useState<CommissionAccrual[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const codeKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [codePage, attributionPage, commissionPage] = await Promise.all([
        exchangeGet<ListResponse<ReferralCode>>("/api/v1/referral-codes", "supplier"),
        exchangeGet<ListResponse<ReferralAttribution>>("/api/v1/referral-attributions", "supplier"),
        exchangeGet<ListResponse<CommissionAccrual>>("/api/v1/commission-accruals", "supplier"),
      ]);
      setCodes(codePage.items);
      setAttributions(attributionPage.items);
      setCommissions(commissionPage.items);
    } catch (loadError) {
      setError(marketplaceErrorMessage(loadError, "单级推荐记录暂时无法加载。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      exchangeGet<ListResponse<ReferralCode>>("/api/v1/referral-codes", "supplier"),
      exchangeGet<ListResponse<ReferralAttribution>>("/api/v1/referral-attributions", "supplier"),
      exchangeGet<ListResponse<CommissionAccrual>>("/api/v1/commission-accruals", "supplier"),
    ]).then(([codePage, attributionPage, commissionPage]) => {
      setCodes(codePage.items);
      setAttributions(attributionPage.items);
      setCommissions(commissionPage.items);
    }).catch((loadError) => {
      setError(marketplaceErrorMessage(loadError, "单级推荐记录暂时无法加载。"));
    }).finally(() => setLoading(false));
  }, []);

  const code = codes[0] ?? null;
  const referralLink = useMemo(() => {
    if (!code || typeof window === "undefined") return "";
    return `${window.location.origin}/resources?ref=${encodeURIComponent(code.code)}`;
  }, [code]);

  async function generateCode() {
    setBusy(true);
    setError("");
    setCopyNotice("");
    try {
      codeKey.current ??= createIdempotencyKey("referral-code");
      const result = await exchangePost<ReferralCode>("/api/v1/referral-codes", "supplier", {}, codeKey.current);
      codeKey.current = null;
      setCodes([result.record]);
    } catch (submitError) {
      setError(marketplaceErrorMessage(submitError, "推荐码生成失败，请稍后重试。"));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!referralLink) return;
    setError("");
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopyNotice("推荐链接已复制。好友打开后，链接参数会记录为同站 TEST 推荐归因。");
    } catch {
      setCopyNotice("浏览器未允许自动复制，请长按或选中链接手动复制。");
    }
  }

  if (loading) return <p className="border-l-2 border-[var(--accent)] pl-4">正在读取推荐码与逐笔记录…</p>;

  return (
    <div className="grid gap-12">
      <section aria-labelledby="referral-boundary-title" className="border-l-4 border-[var(--accent)] bg-[var(--info-bg)] p-5 sm:p-6">
        <p className="kicker">单级推荐边界</p>
        <h2 className="m-0 text-2xl" id="referral-boundary-title">只有一层直接归因，没有团队层级</h2>
        <p className="mb-0 mt-3">仅记录 TEST 推荐归因和 TEST 佣金估算；未发生真实资金结算，不形成余额，不可提现。推荐人不能同时是该订单买方或挂牌供应商。</p>
      </section>

      {error ? <div className="border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">{error}</div> : null}

      <section aria-labelledby="referral-link-title">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="kicker">我的推荐入口</p><h2 className="m-0 text-3xl" id="referral-link-title">生成并分享唯一推荐链接</h2></div>
          <button className="button button-secondary" disabled={busy} onClick={() => void load()} type="button">刷新记录</button>
        </div>
        {!code ? (
          <div className="mt-7 border-y border-[var(--border)] py-6">
            <p className="mt-0">当前会话还没有推荐码。每个 actor 只能生成一个不可变推荐码。</p>
            <button className="button button-primary w-full sm:w-auto" disabled={busy} onClick={() => void generateCode()} type="button">{busy ? "正在生成…" : "生成我的推荐码"}</button>
          </div>
        ) : (
          <div className="mt-7 border-y border-[var(--border)] py-6">
            <dl className="grid gap-5 sm:grid-cols-[220px_minmax(0,1fr)]">
              <div><dt>推荐码</dt><dd className="m-0 break-all font-mono text-xl font-semibold text-[var(--ink)]">{code.code}</dd></div>
              <div><dt>推荐链接</dt><dd className="m-0 break-all font-mono text-sm text-[var(--ink)]">{referralLink}</dd></div>
            </dl>
            <button className="button button-primary mt-5 w-full sm:w-auto" onClick={() => void copyLink()} type="button">复制推荐链接</button>
            {copyNotice ? <p className="mb-0 mt-4 border-l-2 border-[var(--accent)] pl-4" role="status">{copyNotice}</p> : null}
          </div>
        )}
      </section>

      <section aria-labelledby="attribution-title" className="border-t border-[var(--border)] pt-10">
        <p className="kicker">TEST 推荐归因</p>
        <h2 className="m-0 text-3xl" id="attribution-title">逐笔有效归因</h2>
        <p className="section-lead">这里只显示服务端在下单事务中判定为有效的直接归因；无效码和自荐不会出现在列表中，也不会阻断正常下单。</p>
        {attributions.length === 0 ? <p className="mt-6 bg-[var(--info-bg)] p-5">尚无有效 TEST 推荐归因。</p> : (
          <div className="data-table-wrap mt-6">
            <table className="data-table">
              <thead><tr><th>订单</th><th>归因时间</th><th>归因类型</th></tr></thead>
              <tbody>{attributions.map((item) => <tr key={item.id}><td className="font-mono break-all">{item.orderId}</td><td>{new Date(item.attributedAt).toLocaleString("zh-CN")}</td><td>单级直接归因</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="commission-title" className="border-t border-[var(--border)] pt-10">
        <p className="kicker">TEST 佣金估算事实</p>
        <h2 className="m-0 text-3xl" id="commission-title">逐笔查看结算时生成的估算</h2>
        <p className="section-lead">估算比例为订单不可变合同金额的 3%。记录与 TEST 结算同事务生成，但不进入资金账本，也不改变供应商应付金额。</p>
        {commissions.length === 0 ? <p className="mt-6 bg-[var(--info-bg)] p-5">尚无 TEST 佣金估算记录。</p> : (
          <div className="data-table-wrap mt-6">
            <table className="data-table">
              <thead><tr><th>订单</th><th>估算基数</th><th>比例</th><th>TEST 估算金额</th><th>记录时间</th></tr></thead>
              <tbody>{commissions.map((item) => <tr key={item.id}><td className="font-mono break-all">{item.orderId}</td><td>{money(item.commissionBaseCents)}</td><td>3%</td><td className="font-semibold text-[var(--ink)]">{money(item.commissionEstimateCents)}</td><td>{new Date(item.createdAt).toLocaleString("zh-CN")}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <p className="mt-5 border-l-2 border-[var(--warning)] pl-4 text-sm">所有记录均为 environment=TEST、recordKind=ESTIMATE_ONLY、fundsMoved=false。</p>
      </section>
    </div>
  );
}
