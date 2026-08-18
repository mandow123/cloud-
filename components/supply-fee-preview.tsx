import Link from "next/link";
import type { HostingSupplierFeePreview } from "@/lib/hosting-v2";
import { formatCardHours, formatHostingTime } from "@/lib/hosting-v2-client";
import styles from "./supply-console.module.css";

const FEE_TIER_LABELS: Record<string, string> = {
  STARTER: "起步档",
  GROWTH: "成长档",
  SCALE: "规模档",
  VOLUME: "大客户档",
  STRATEGIC: "战略档",
};

type FeeQualificationView = Readonly<{
  model: string;
  tierCode: string;
  qualifyingVolumeMicros: number;
  asOf?: string;
  period?: Readonly<{ key: string }>;
}>;

export function feeTierLabel(code: string | null) {
  if (!code) return "尚未生效";
  return FEE_TIER_LABELS[code] ?? code;
}

export function formatBasisPoints(value: number | null) {
  if (value === null || !Number.isInteger(value) || value < 0) return "未配置";
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}%`;
}

function nextTierMessage(preview: HostingSupplierFeePreview) {
  if (preview.nextTierCode && preview.remainingToNextTierMicros !== null) {
    return `距${feeTierLabel(preview.nextTierCode)}还差 ${formatCardHours(preview.remainingToNextTierMicros)} KAI`;
  }
  return preview.tierCode ? "已达到最低手续费档" : "等待平台启用有效费率";
}

function tierRange(preview: HostingSupplierFeePreview, index: number) {
  const tier = preview.tiers[index];
  const next = preview.tiers[index + 1];
  const start = formatCardHours(tier.minimumQualifyingMicros);
  return next ? `${start}–<${formatCardHours(next.minimumQualifyingMicros)}` : `≥${start}`;
}

export function feeQualificationDescription(qualification: FeeQualificationView) {
  if (qualification.model === "LIFETIME_SUPPLIER_SETTLED_GROSS_V1" && qualification.asOf) {
    return `累计有效成交 ${formatCardHours(qualification.qualifyingVolumeMicros)} KAI · 截止 ${formatHostingTime(qualification.asOf)}`;
  }
  return qualification.period
    ? `旧版月度档位 · ${qualification.period.key} 合格成交 ${formatCardHours(qualification.qualifyingVolumeMicros)} KAI`
    : `成交时累计有效成交 ${formatCardHours(qualification.qualifyingVolumeMicros)} KAI`;
}

export function SupplyFeePreviewStrip({ preview }: { preview: HostingSupplierFeePreview }) {
  return (
    <div className={styles.feeStrip} aria-label="当前累计成交手续费档位">
      <strong>当前供应服务费 {formatBasisPoints(preview.platformFeeBps)} · {feeTierLabel(preview.tierCode)}</strong>
      <span>累计有效成交 {formatCardHours(preview.qualifyingVolumeMicros)} KAI</span>
      <small>{nextTierMessage(preview)} · 最近计算于 {formatHostingTime(preview.asOf)}。推荐佣金包含在本笔平台服务费内，不会再次向供应方或买家加收。</small>
    </div>
  );
}

export function SupplyFeeTierFold({ preview }: { preview: HostingSupplierFeePreview }) {
  return (
    <details className={styles.feeFold}>
      <summary>
        <span>费率与成交量</span>
        <strong>{formatBasisPoints(preview.platformFeeBps)} · {feeTierLabel(preview.tierCode)}</strong>
        <small>累计有效成交 {formatCardHours(preview.qualifyingVolumeMicros)} KAI · {nextTierMessage(preview)}</small>
      </summary>
      <div className={styles.feeFoldBody}>
        {preview.tiers.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.feeTierTable}>
              <thead><tr><th>档位</th><th>累计有效成交（KAI）</th><th>平台手续费</th></tr></thead>
              <tbody>{preview.tiers.map((tier, index) => (
                <tr className={tier.code === preview.tierCode ? styles.feeTierCurrent : undefined} key={tier.code}>
                  <td><strong>{feeTierLabel(tier.code)}</strong>{tier.code === preview.tierCode ? <small>当前档位</small> : null}</td>
                  <td>{tierRange(preview, index)}</td>
                  <td>{formatBasisPoints(tier.platformFeeBps)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className={styles.foldEmpty}>平台尚未启用有效费率版本，新的挂牌成交保持关闭。</p>}
        <div className={styles.feeFoldMeta}>
          <p><strong>累计有效成交口径</strong><span>当前供应组织历史已结算、未退款的成交毛额。真实结算、退款或冲正后由服务端更新，只影响之后的新订单。</span></p>
          <p><strong>最近计算</strong><span>{formatHostingTime(preview.asOf)}</span></p>
          <Link className={styles.tableLink} href="/supply/earnings">查看收益与账本 →</Link>
        </div>
      </div>
    </details>
  );
}

export function SupplyFeeUnavailableFold({ message }: { message: string }) {
  return (
    <details className={styles.feeFold}>
      <summary>
        <span>费率与成交量</span>
        <strong>暂不可用</strong>
        <small>服务端费率未能读取；设备管理可继续，新的挂牌成交保持关闭</small>
      </summary>
      <div className={styles.feeFoldBody}>
        <p className={styles.foldEmpty}>{message}</p>
        <div className={styles.feeFoldMeta}>
          <p><strong>安全状态</strong><span>页面不会推算或缓存费率。服务端恢复并返回有效档位前，不展示金额，也不开放新的挂牌成交。</span></p>
        </div>
      </div>
    </details>
  );
}
