"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { HostingDashboard } from "@/lib/hosting-v2";
import { marketplaceErrorMessage, marketplaceGet } from "@/lib/client/marketplace-client";
import styles from "./supply-console.module.css";

function dateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function SupplyResources() {
  const [dashboard, setDashboard] = useState<HostingDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await marketplaceGet<{ dashboard: HostingDashboard }>("/api/v2/supply/dashboard");
      setDashboard(result.dashboard);
    } catch (cause) {
      setError(marketplaceErrorMessage(cause, "资源列表暂时无法读取。"));
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  if (error) return <section className={styles.error} role="alert"><h2>资源读取失败</h2><p>{error}</p><button className={`${styles.secondaryAction} mt-4`} onClick={() => void load()} type="button">重新读取</button></section>;
  if (!dashboard) return <div className={styles.loading} role="status">正在读取当前组织的资源与验真状态…</div>;

  const approved = dashboard.profile?.status === "APPROVED";

  return (
    <>
      <div className={styles.pageHeading}>
        <div><h1>资源与设备</h1><p>设备由 Host Agent 使用一次性凭证登记。浏览器选择的模板只用于准备说明，最终规格以签名硬件证据为准。</p></div>
        {approved ? <Link className={styles.primaryAction} href="/supply/resources/new">登记新资源</Link> : <Link className={styles.secondaryAction} href="/supply/onboarding">先完成供应商审核</Link>}
      </div>

      {!approved ? <div className={styles.warningBox}>当前供应主体尚未通过审核，因此不能签发 Agent 配对凭证。可以查看已有记录，但新增登记保持关闭。</div> : null}

      <section className={styles.dataSection} aria-labelledby="resource-list-title">
        <header className={styles.panelHeader}><h2 id="resource-list-title">已登记设备</h2><span>{dashboard.devices.length} 台</span></header>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>设备</th><th>GPU</th><th>Agent 状态</th><th>验真状态</th><th>验真有效期</th><th>操作</th></tr></thead>
            <tbody>
              {dashboard.devices.length ? dashboard.devices.map((device) => (
                <tr key={device.id}>
                  <td>{device.displayName}<br /><small>{device.id}</small></td>
                  <td>{device.inventory.gpuModel}<br /><small>{device.inventory.gpuMemoryMiB} MiB</small></td>
                  <td>{device.status}</td><td>{device.verificationStatus}</td><td>{dateTime(device.verifiedUntil)}</td>
                  <td><Link href={`/supply/resources/${encodeURIComponent(device.id)}`}>查看设备 →</Link></td>
                </tr>
              )) : <tr><td className={styles.emptyRow} colSpan={6}>尚未登记设备。审核通过后，可签发一次性配对凭证连接第一台主机。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
