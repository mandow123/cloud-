"use client";

import { useCallback, useEffect, useState } from "react";
import { marketplaceErrorMessage, marketplaceGet } from "@/lib/client/marketplace-client";
import type { SupplierEarningsDashboard } from "@/lib/hosting-v2-client";
import { formatCardHours, formatHostingTime } from "@/lib/hosting-v2-client";
import styles from "./supply-console.module.css";

const OPERATION_LABELS: Record<string, string> = {
  TOPUP: "卡时发放 / 充值",
  ORDER_HOLD: "订单锁定",
  ORDER_RELEASE: "订单释放",
  ORDER_CAPTURE: "订单结算",
  RENTAL_INCOME: "租金收益",
  COMMISSION_INCOME: "佣金收益",
};

const FEE_TIER_LABELS: Record<string, string> = {
  STARTER: "起步档",
  GROWTH: "成长档",
  SCALE: "规模档",
  VOLUME: "大客户档",
  STRATEGIC: "战略档",
};

function formatBasisPoints(value: number | null) {
  if (value === null || !Number.isInteger(value) || value < 0) return "未配置";
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}%`;
}

export function SupplyEarnings() {
  const [earnings, setEarnings] = useState<SupplierEarningsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await marketplaceGet<{ earnings: SupplierEarningsDashboard }>("/api/v2/supply/earnings");
      setEarnings(result.earnings);
    } catch (cause) {
      setError(marketplaceErrorMessage(cause, "卡时收益和账本暂时无法读取。"));
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  return (
    <>
      <div className={styles.pageHeading}>
        <div><h1>卡时收益</h1><p>租金和佣金以 KAI 标准卡时入账；每笔变化都来自不可变双式账本。</p></div>
        <button className={styles.secondaryAction} disabled={!earnings} onClick={() => void load()} type="button">刷新账本</button>
      </div>
      {error ? <div className={`${styles.message} ${styles.messageError}`} role="alert">{error}</div> : null}
      {!earnings ? <div className={styles.loading} role="status">正在读取可用卡时、租金、佣金和账本…</div> : (
        <>
          <div className={styles.earningsMetrics}>
            <div><span>可用卡时</span><strong>{formatCardHours(earnings.balance.availableMicros)}</strong><small>KAI 标准卡时</small></div>
            <div><span>已归属租金</span><strong>{formatCardHours(earnings.income.rentalVestedMicros)}</strong><small>待结算 {formatCardHours(earnings.income.rentalPendingMicros)}</small></div>
            <div><span>已归属佣金</span><strong>{formatCardHours(earnings.income.commissionVestedMicros)}</strong><small>待结算 {formatCardHours(earnings.income.commissionPendingMicros)}</small></div>
            <div><span>邀请组织</span><strong>{earnings.referral.invitedOrganizations}</strong><small>推荐码 {earnings.referral.code}</small></div>
          </div>

          <div className={styles.feeStrip} aria-label="当前供应服务费档位">
            <strong>本月服务费 {formatBasisPoints(earnings.feePreview.platformFeeBps)} · {earnings.feePreview.tierCode ? (FEE_TIER_LABELS[earnings.feePreview.tierCode] ?? earnings.feePreview.tierCode) : "尚未生效"}</strong>
            <span>上月合格成交 {formatCardHours(earnings.feePreview.qualifyingVolumeMicros)} KAI</span>
            <small>{earnings.feePreview.period.key} 的已结算、未退款毛额决定本月档位；{formatHostingTime(earnings.feePreview.nextRecalculationAt)} 重新计算。推荐佣金包含在平台服务费内。</small>
          </div>

          <section className={styles.dataSection} aria-labelledby="settlement-summary-title">
            <header className={styles.panelHeader}><h2 id="settlement-summary-title">{earnings.monthlySettlement.period.key} 月度分账</h2><span>实际已结算订单</span></header>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>成交毛额 G</th><th>平台服务费 F</th><th>供应方净收益 S</th><th>推荐佣金 C（F 内）</th><th>平台净收入 P</th></tr></thead>
                <tbody><tr>
                  <td>{formatCardHours(earnings.monthlySettlement.grossMicros)} KAI</td>
                  <td>{formatCardHours(earnings.monthlySettlement.platformFeeMicros)} KAI</td>
                  <td>{formatCardHours(earnings.monthlySettlement.supplierIncomeMicros)} KAI</td>
                  <td>{formatCardHours(earnings.monthlySettlement.inFeeReferralCommissionMicros)} KAI</td>
                  <td>{formatCardHours(earnings.monthlySettlement.platformNetMicros)} KAI</td>
                </tr></tbody>
              </table>
            </div>
          </section>

          <div className={styles.earningsGrid}>
            <section className={styles.dataSection} aria-labelledby="ledger-title">
              <header className={styles.panelHeader}><h2 id="ledger-title">账本明细</h2><span>最近 {earnings.ledger.length} 条</span></header>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>时间</th><th>业务</th><th>业务键</th><th>方向</th><th>卡时</th><th>变动后余额</th></tr></thead>
                  <tbody>{earnings.ledger.length ? earnings.ledger.map((entry, index) => (
                    <tr key={`${entry.businessKey}:${entry.createdAt}:${index}`}><td>{formatHostingTime(entry.createdAt)}</td><td>{OPERATION_LABELS[entry.operation] ?? entry.operation}</td><td><code>{entry.businessKey}</code></td><td>{entry.side === "CREDIT" ? "收入" : "支出"}</td><td className={entry.side === "CREDIT" ? styles.credit : styles.debit}>{entry.side === "CREDIT" ? "+" : "−"}{formatCardHours(entry.amountMicros)}</td><td>{entry.balanceAfterMicros === null ? "—" : formatCardHours(entry.balanceAfterMicros)}</td></tr>
                  )) : <tr><td className={styles.emptyRow} colSpan={6}>账本还没有记录。真实订单结算后，租金和佣金会分别入账。</td></tr>}</tbody>
                </table>
              </div>
            </section>
            <aside className={styles.sidePanel}>
              <section><h2>标准换算</h2><p>1 KAI 标准卡时 = ¥1.002，仅作为平台固定参考换算。成交与收益均以卡时记账。</p></section>
              <section><h3>我的推荐佣金</h3><p>上方 C 是供应订单对应推荐人的佣金，不等同于你的推荐收入。你的推荐收益单独进入“已归属佣金”和账本，奖励比例使用订单冻结的费率版本。</p></section>
              <section><h3>卡时回购 / 变现</h3><p>申请、锁定和审核结构保留，但生产出款尚未开放。完成法务、支付、发票和资金存管前，不承诺随时兑付。</p><button className={styles.disabledAction} disabled type="button">变现申请暂未开放</button></section>
              <section><small>账本更新于 {formatHostingTime(earnings.updatedAt)}</small></section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
