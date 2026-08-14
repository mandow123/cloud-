"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { hostingContractStatusLabel, type SupplierDeviceWorkspaceState, type SupplierHostingDashboard, type SupplierHostingPolicy } from "@/lib/hosting-v2-client";
import { marketplaceErrorMessage, marketplaceGet } from "@/lib/client/marketplace-client";
import { SupplyFeeTierFold, SupplyFeeUnavailableFold } from "./supply-fee-preview";
import styles from "./supply-console.module.css";

function dateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

const verificationLabels = {
  NOT_RUN: "未验真",
  PENDING: "验真中",
  PASSED: "已通过",
  FAILED: "未通过",
  EXPIRED: "已过期",
} as const;

export function SupplyResources() {
  const [dashboard, setDashboard] = useState<SupplierHostingDashboard | null>(null);
  const [policy, setPolicy] = useState<SupplierHostingPolicy | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "TASKS" | SupplierDeviceWorkspaceState>("ALL");

  const load = useCallback(async () => {
    setError(null);
    setFeeError(null);
    try {
      const [dashboardResult, policyResult] = await Promise.allSettled([
        marketplaceGet<{ dashboard: SupplierHostingDashboard }>("/api/v2/supply/dashboard"),
        marketplaceGet<{ policy: SupplierHostingPolicy }>("/api/v2/supply/policy"),
      ]);
      if (dashboardResult.status === "rejected") throw dashboardResult.reason;
      setDashboard(dashboardResult.value.dashboard);
      if (policyResult.status === "fulfilled") {
        setPolicy(policyResult.value.policy);
      } else {
        setPolicy(null);
        setFeeError(marketplaceErrorMessage(policyResult.reason, "累计成交费率暂时无法读取。"));
      }
    } catch (cause) {
      setError(marketplaceErrorMessage(cause, "托管设备暂时无法读取。"));
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  if (error) return <section className={styles.error} role="alert"><h2>资源读取失败</h2><p>{error}</p><button className={`${styles.secondaryAction} mt-4`} onClick={() => void load()} type="button">重新读取</button></section>;
  if (!dashboard) return <div className={styles.loading} role="status">正在读取当前组织的资源、验真状态与累计成交费率…</div>;

  const approved = dashboard.readiness.supplierApproved;
  const workspace = dashboard.deviceWorkspace;
  const filters = [
    ["ALL", "全部", workspace.records.length],
    ["AVAILABLE", "待租", workspace.summary.AVAILABLE],
    ["OPERATING", "运营中", workspace.summary.OPERATING],
    ["DEPLOYING", "部署中", workspace.summary.DEPLOYING],
    ["TASKS", "待处理", workspace.records.filter((record) => record.taskCount > 0).length],
    ["OFFLINE", "离线", workspace.summary.OFFLINE],
    ["DISABLED", "已停用", workspace.summary.DISABLED],
  ] as const;
  const visibleRecords = filter === "ALL"
    ? workspace.records
    : filter === "TASKS"
      ? workspace.records.filter((record) => record.taskCount > 0)
      : workspace.records.filter((record) => record.state === filter);
  const urgentTaskCount = workspace.tasks.filter((task) => task.priority === "P0" || task.priority === "P1").length;

  return (
    <>
      <div className={styles.pageHeading}>
        <div><h1>托管设备</h1><p>一台设备只显示一个当前运营状态。部署、订单、验真与心跳均由服务端真实数据合并，不由浏览器猜测。</p></div>
        {approved ? <Link className={styles.primaryAction} href="/supply/devices/new">连接托管设备</Link> : <Link className={styles.secondaryAction} href="/supply/onboarding">先完成供应商审核</Link>}
      </div>

      {!approved ? <div className={styles.warningBox}>当前供应主体尚未通过审核，因此不能签发 Agent 配对凭证。可以查看已有记录，但新增登记保持关闭。</div> : null}

      <section className={styles.deviceOverview} aria-label="设备状态概览">
        <div><span>托管设备</span><strong>{workspace.records.length}</strong><small>当前组织</small></div>
        <div><span>运营中</span><strong>{workspace.summary.OPERATING}</strong><small>正在计量或待验收</small></div>
        <div><span>部署中</span><strong>{workspace.summary.DEPLOYING}</strong><small>验真、锁定或开通中</small></div>
        <div><span>待处理</span><strong>{workspace.tasks.length}</strong><small>{urgentTaskCount} 项优先处理</small></div>
      </section>

      <details className={styles.taskFold} open={urgentTaskCount > 0}>
        <summary><span>待办队列</span><strong>{workspace.tasks.length}</strong><small>{urgentTaskCount ? `${urgentTaskCount} 项需要优先处理` : "默认折叠，避免页面堆叠"}</small></summary>
        <div className={styles.taskList}>
          {workspace.tasks.length ? workspace.tasks.map((task) => (
            <Link href={task.href} key={task.id}>
              <span className={`${styles.taskPriority} ${task.priority === "P0" ? styles.taskPriorityCritical : task.priority === "P1" ? styles.taskPriorityWarning : ""}`}>{task.priority}</span>
              <span><strong>{task.title}</strong><small>{task.description}</small></span>
              <b aria-hidden="true">→</b>
            </Link>
          )) : <p className={styles.foldEmpty}>当前没有待处理事项。</p>}
        </div>
      </details>

      {policy ? <SupplyFeeTierFold preview={policy.feePreview} /> : <SupplyFeeUnavailableFold message={feeError ?? "累计成交费率正在读取。"} />}

      <section className={styles.dataSection} aria-labelledby="resource-list-title">
        <header className={styles.deviceListHeader}>
          <div><h2 id="resource-list-title">设备列表</h2><span>状态更新时间 {dateTime(workspace.generatedAt)}</span></div>
          <div className={styles.deviceFilters} role="group" aria-label="按设备状态筛选">
            {filters.map(([value, label, count]) => <button aria-pressed={filter === value} key={value} onClick={() => setFilter(value)} type="button">{label}<span>{count}</span></button>)}
          </div>
        </header>
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.deviceTable}`}>
            <thead><tr><th>设备</th><th>当前状态</th><th>GPU</th><th>挂牌</th><th>最后心跳</th><th>操作</th></tr></thead>
            <tbody>
              {visibleRecords.length ? visibleRecords.map((device) => (
                <tr key={device.id}>
                  <td data-label="设备"><strong>{device.displayName}</strong><br /><small>{device.id}</small></td>
                  <td data-label="当前状态"><span className={`${styles.deviceState} ${device.state === "ACTION_REQUIRED" || device.state === "OFFLINE" ? styles.deviceStateWarning : device.state === "DISABLED" ? styles.deviceStateMuted : ""}`}>{device.stateLabel}</span><small className={styles.deviceStateDetail}>{device.stateDetail}</small></td>
                  <td data-label="GPU">{device.gpuModel}<br /><small>{device.gpuMemoryMiB} MiB · {verificationLabels[device.verificationStatus]}</small></td>
                  <td data-label="挂牌">{device.publishedOfferCount ? `${device.publishedOfferCount} 条可售` : "未挂牌"}{device.activeContractStatus ? <><br /><small>{hostingContractStatusLabel(device.activeContractStatus)}</small></> : null}</td>
                  <td data-label="最后心跳">{dateTime(device.lastSeenAt)}</td>
                  <td data-label="操作"><Link aria-label={`${device.displayName}：${device.primaryAction.label}`} className={styles.tableLink} href={device.primaryAction.href}>{device.primaryAction.label} →</Link></td>
                </tr>
              )) : <tr><td className={styles.emptyRow} colSpan={6}>{workspace.records.length ? "当前筛选条件下没有设备。" : "尚未登记设备。审核通过后，可签发一次性配对凭证连接第一台主机。"}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <details className={styles.historyFold}>
        <summary><span>资产生命周期能力</span><small>续约、回购、关闭与恢复运营</small></summary>
        <div className={styles.historyGrid}>
          <section><div><strong>{workspace.historyCapabilities.renewal.label}</strong><span>尚未开放</span></div><p>{workspace.historyCapabilities.renewal.reason}</p></section>
          <section><div><strong>{workspace.historyCapabilities.buyback.label}</strong><span>尚未开放</span></div><p>{workspace.historyCapabilities.buyback.reason}</p></section>
          <section><div><strong>{workspace.historyCapabilities.decommission.label}</strong><span>尚未开放</span></div><p>{workspace.historyCapabilities.decommission.reason}</p></section>
          <section><div><strong>已恢复运营</strong><span>状态事件</span></div><p>设备离线后恢复心跳并重新通过验真，会回到“待租”或“运营中”，不会伪装成合同续约。</p></section>
        </div>
      </details>
    </>
  );
}
