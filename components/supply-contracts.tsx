"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { marketplaceErrorMessage, marketplaceGet } from "@/lib/client/marketplace-client";
import type { SupplierHostingContract } from "@/lib/hosting-v2-client";
import { formatCardHours, formatHostingTime, hostingContractStatusLabel } from "@/lib/hosting-v2-client";
import styles from "./supply-console.module.css";

export function SupplyContracts() {
  const [contracts, setContracts] = useState<SupplierHostingContract[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await marketplaceGet<{ records: SupplierHostingContract[] }>("/api/v2/supply/contracts");
      setContracts(result.records);
    } catch (cause) {
      setError(marketplaceErrorMessage(cause, "供应订单暂时无法读取。"));
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  const records = useMemo(() => [...(contracts ?? [])].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)), [contracts]);

  return (
    <>
      <div className={styles.pageHeading}>
        <div><h1>供应订单</h1><p>订单由买家真实卡时锁定生成；Host Agent 负责开通、计量、停止和清理，网页不伪造履约状态。</p></div>
        <button className={styles.secondaryAction} disabled={!contracts} onClick={() => void load()} type="button">刷新订单</button>
      </div>
      {error ? <div className={`${styles.message} ${styles.messageError}`} role="alert">{error}</div> : null}
      {!contracts ? <div className={styles.loading} role="status">正在读取供应订单和 Host Agent 状态…</div> : (
        <section className={styles.dataSection} aria-labelledby="contracts-title">
          <header className={styles.panelHeader}><h2 id="contracts-title">全部供应订单</h2><span>{records.length} 笔</span></header>
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.wideTable}`}>
              <thead><tr><th>合同</th><th>资源快照</th><th>预留</th><th>实际计量</th><th>租金收益</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                {records.length ? records.map((contract) => (
                  <tr key={contract.id}>
                    <td><strong>{contract.id}</strong><br /><small>{formatHostingTime(contract.createdAt)}</small></td>
                    <td>{contract.snapshot.title}<br /><small>{contract.snapshot.gpuModel} · {contract.snapshot.region}</small></td>
                    <td>{Math.ceil(contract.reservedSeconds / 60)} 分钟<br /><small>{formatCardHours(contract.heldMicros)} KAI 已锁定</small></td>
                    <td>{contract.measuredSeconds === null ? "等待 Agent" : `${contract.measuredSeconds} 秒`}</td>
                    <td>{contract.supplierIncomeMicros === null ? "待结算" : `${formatCardHours(contract.supplierIncomeMicros)} KAI`}</td>
                    <td><span className={styles.statusBadge}>{hostingContractStatusLabel(contract.status)}</span></td>
                    <td><Link className={styles.tableLink} href={`/supply/orders/${encodeURIComponent(contract.id)}`}>查看履约 →</Link></td>
                  </tr>
                )) : <tr><td className={styles.emptyRow} colSpan={7}>还没有真实订单。公开挂牌被买家预留并成功锁定卡时后，订单才会出现。</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
