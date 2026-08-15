import { formatKaiDateTime, formatKaiDecimal, formatKaiSchDisplay } from "@/lib/kai-standard-view-models";
import styles from "./kai-standard-pages.module.css";

export type KaiStandardEquivalentLineProps = Readonly<{
  nativeAmount: string;
  nativeUnitLabel: string;
  kaiSchAmount: string;
  policyVersion: string;
  asOf: string;
  label?: string;
  stale?: boolean;
}>;

export function KaiStandardEquivalentLine({
  nativeAmount,
  nativeUnitLabel,
  kaiSchAmount,
  policyVersion,
  asOf,
  label = "当前市场等值",
  stale = false,
}: KaiStandardEquivalentLineProps) {
  return (
    <dl className={styles.equivalentLine} aria-label="原生容量与 KAI 标准卡时等值">
      <div>
        <dt>原生容量</dt>
        <dd>{formatKaiDecimal(nativeAmount)} {nativeUnitLabel}</dd>
        <small>订单锁定与交付依据</small>
      </div>
      <div>
        <dt>{label}</dt>
        <dd>{formatKaiSchDisplay(kaiSchAmount)} KAI-SCH</dd>
        <small>只用于同一时点比较</small>
      </div>
      <div>
        <dt>折算快照</dt>
        <dd>{policyVersion}</dd>
        <small>{formatKaiDateTime(asOf)}{stale ? " · 已过期" : ""}</small>
      </div>
    </dl>
  );
}
