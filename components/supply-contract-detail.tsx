"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { marketplaceErrorMessage, marketplaceGet } from "@/lib/client/marketplace-client";
import type { SupplierHostingContract } from "@/lib/hosting-v2-client";
import { formatCardHours, formatEvidenceDigest, formatHostingTime, hostingContractStatusLabel } from "@/lib/hosting-v2-client";
import styles from "./supply-console.module.css";

const POLLED = new Set(["CARD_HOURS_HELD", "PROVISIONING", "READY", "IN_SERVICE", "AWAITING_ACCEPTANCE", "SETTLED", "CLEANING", "DISPUTED"]);
const STEPS = ["CARD_HOURS_HELD", "PROVISIONING", "READY", "IN_SERVICE", "AWAITING_ACCEPTANCE", "CLEANING", "CLEANED"] as const;

function stepIndex(status: SupplierHostingContract["status"]) {
  if (status === "SETTLED") return 5;
  return STEPS.indexOf(status as (typeof STEPS)[number]);
}

function deliveryMessage(contract: SupplierHostingContract) {
  switch (contract.status) {
    case "CARD_HOURS_HELD": return "买家卡时已经锁定，等待买家提交 SSH 公钥。";
    case "PROVISIONING": return "Host Agent 正在创建受限容器、注入临时公钥并验证 SSH 入口。";
    case "READY": return "实例入口已验证，等待买家启动服务；尚未进入服务计量。";
    case "IN_SERVICE": return "实例正在运行，服务端以 Agent 证据计算实际运行秒数。";
    case "AWAITING_ACCEPTANCE": return "实例已停止并生成计量结果，等待买家在冻结时限内验收或发起争议；无争议到期后平台自动结算。";
    case "SETTLED": return "租金已按冻结计量与合同费率归属，等待受限清理任务排队。";
    case "CLEANING": return contract.evidence?.dispute?.proposedResolution === "REFUND" && contract.evidence.dispute.proposalStatus === "APPLIED"
      ? "卡时已全额退回，Host Agent 正在撤权并清理工作区；供应方不会获得本单租金。"
      : "租金已归属，Host Agent 正在撤权并清理工作区。";
    case "CLEANED": return "容器、公钥和工作目录已清理，设备通过复用检查后可重新挂牌。";
    case "FAILED": return "交付失败，设备已进入排空或风控处理，不能自动重新挂牌。";
    case "DISPUTED": return "买家已发起争议，卡时和机器均保持冻结；平台提案须经独立财务复核后才能退款或结算。";
    case "REFUNDED": return "争议已裁决为全额退回；临时权限已清理，供应方未获得本单租金。";
    default: return `订单当前为“${hostingContractStatusLabel(contract.status)}”。`;
  }
}

export function SupplyContractDetail({ contractId }: { contractId: string }) {
  const [contract, setContract] = useState<SupplierHostingContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    try {
      const result = await marketplaceGet<{ record: SupplierHostingContract }>(`/api/v2/supply/contracts/${encodeURIComponent(contractId)}`);
      setContract(result.record); setError(null);
    } catch (cause) {
      setError(marketplaceErrorMessage(cause, "供应订单详情暂时无法读取。"));
    } finally { if (!quiet) setLoading(false); }
  }, [contractId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);
  useEffect(() => {
    if (!contract || !POLLED.has(contract.status)) return;
    const timer = window.setInterval(() => { void load(true); }, 5_000);
    return () => window.clearInterval(timer);
  }, [contract, load]);

  if (loading) return <div className={styles.loading} role="status">正在读取合同快照、计量与清理状态…</div>;
  if (!contract) return <section className={styles.error} role="alert"><h2>无法打开供应订单</h2><p>{error}</p><Link className={`${styles.secondaryAction} mt-4`} href="/supply/orders">返回订单列表</Link></section>;

  const currentStep = stepIndex(contract.status);
  return (
    <>
      <div className={styles.pageHeading}>
        <div><h1>{contract.snapshot.title}</h1><p>合同 {contract.id} · 设备 {contract.deviceId} · 状态版本 v{contract.version}</p></div>
        <div className={styles.actionRow}><span className={styles.statusBadge}>{hostingContractStatusLabel(contract.status)}</span><button className={styles.secondaryAction} onClick={() => void load()} type="button">刷新状态</button></div>
      </div>
      {error ? <div className={`${styles.message} ${styles.messageError}`} role="alert">{error}</div> : null}

      <ol className={styles.contractSteps} aria-label="供应订单履约进度">
        {STEPS.map((status, index) => <li className={index <= currentStep ? styles.contractStepDone : undefined} key={status}><span>{String(index + 1).padStart(2, "0")}</span><strong>{hostingContractStatusLabel(status)}</strong></li>)}
      </ol>

      <div className={styles.detailGrid}>
        <div className={styles.detailStack}>
          <section className={styles.panel} aria-labelledby="delivery-state-title">
            <header className={styles.panelHeader}><h2 id="delivery-state-title">当前履约状态</h2><span>{formatHostingTime(contract.updatedAt)}</span></header>
            <div className={styles.deliveryState}><h3>{hostingContractStatusLabel(contract.status)}</h3><p>{deliveryMessage(contract)}</p>{contract.endpointDisplay ? <code>{contract.endpointDisplay}</code> : null}</div>
          </section>
          <section className={styles.panel} aria-labelledby="metering-title">
            <header className={styles.panelHeader}><h2 id="metering-title">计量与结算</h2><span>仅服务端写入</span></header>
            <dl className={styles.inventoryGrid}>
              <div><dt>预留时长</dt><dd>{contract.reservedSeconds} 秒</dd></div><div><dt>实际计量</dt><dd>{contract.measuredSeconds === null ? "等待 Agent" : `${contract.measuredSeconds} 秒`}</dd></div>
              <div><dt>买家锁定</dt><dd>{formatCardHours(contract.heldMicros)} KAI</dd></div><div><dt>实际结算</dt><dd>{contract.settledMicros === null ? "待验收" : `${formatCardHours(contract.settledMicros)} KAI`}</dd></div>
              <div><dt>供应方租金</dt><dd>{contract.supplierIncomeMicros === null ? "待结算" : `${formatCardHours(contract.supplierIncomeMicros)} KAI`}</dd></div><div><dt>本单佣金</dt><dd>{contract.commissionMicros === null ? "待结算" : `${formatCardHours(contract.commissionMicros)} KAI`}</dd></div>
            </dl>
          </section>
          <section className={styles.panel} aria-labelledby="delivery-facts-title">
            <header className={styles.panelHeader}><h2 id="delivery-facts-title">交付事实</h2><span>不可由浏览器改写</span></header>
            <ul className={styles.timeline}>
              <li><span>SSH 公钥指纹</span><strong>{contract.sshPublicKeyFingerprint ?? "尚未提交"}</strong></li>
              <li><span>开始服务</span><strong>{formatHostingTime(contract.startedAt)}</strong></li>
              <li><span>停止服务</span><strong>{formatHostingTime(contract.stoppedAt)}</strong></li>
              <li><span>买家验收</span><strong>{formatHostingTime(contract.acceptedAt)}</strong></li>
              <li><span>最后更新</span><strong>{formatHostingTime(contract.updatedAt)}</strong></li>
              <li><span>容器身份</span><strong title={contract.evidence?.instance?.containerDigest}>{formatEvidenceDigest(contract.evidence?.instance?.containerDigest)}</strong></li>
              <li><span>平台计费凭证</span><strong>{contract.evidence?.metering ? `${contract.evidence.metering.serverMeasuredSeconds} 秒 · ${formatEvidenceDigest(contract.evidence.metering.evidenceDigest)}` : "尚未生成"}</strong></li>
              <li><span>撤权清理凭证</span><strong>{contract.evidence?.cleanup ? `三项已验证 · ${formatEvidenceDigest(contract.evidence.cleanup.evidenceDigest)}` : "尚未生成"}</strong></li>
            </ul>
          </section>
        </div>
        <aside className={styles.sidePanel}>
          <section><h2>合同快照</h2><ul><li>{contract.snapshot.gpuModel} · {contract.snapshot.region}</li><li>{formatCardHours(contract.snapshot.cardHourMicrosPerGpuHour)} KAI / GPU 小时</li><li>{contract.snapshot.approvedImage}</li><li>{contract.snapshot.termsVersion}</li></ul></section>
          <section><h3>安全边界</h3><p>供应方页面只能读取当前组织的合同；不返回买家账户或组织标识，也不能提交计量、金额和结算状态。</p></section>
          <section><h3>异常处理</h3><p>开通、计量或清理失败会停止自动复售。请保留主机在线，等待平台根据 Agent 证据处理。</p></section>
          <section><Link className={styles.secondaryAction} href={`/supply/resources/${encodeURIComponent(contract.deviceId)}`}>查看关联设备</Link></section>
        </aside>
      </div>
    </>
  );
}
