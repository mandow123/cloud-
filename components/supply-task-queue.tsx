"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { SupplierHostingDashboard } from "@/lib/hosting-v2-client";
import { marketplaceErrorMessage, marketplaceGet } from "@/lib/client/marketplace-client";
import styles from "./supply-console.module.css";

export function SupplyTaskQueue() {
  const [dashboard, setDashboard] = useState<SupplierHostingDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await marketplaceGet<{ dashboard: SupplierHostingDashboard }>("/api/v2/supply/dashboard");
      setDashboard(result.dashboard);
    } catch (cause) {
      setError(marketplaceErrorMessage(cause, "待办队列暂时无法读取。"));
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  if (error) return <section className={styles.error} role="alert"><h2>待办读取失败</h2><p>{error}</p><button className={`${styles.secondaryAction} mt-4`} onClick={() => void load()} type="button">重新读取</button></section>;
  if (!dashboard) return <div className={styles.loading} role="status">正在从真实设备、合同和验真状态生成待办…</div>;

  const { tasks, records, generatedAt } = dashboard.deviceWorkspace;
  const deviceNames = new Map(records.map((record) => [record.id, record.displayName]));
  const counts = { P0: tasks.filter((task) => task.priority === "P0").length, P1: tasks.filter((task) => task.priority === "P1").length, P2: tasks.filter((task) => task.priority === "P2").length };

  return (
    <>
      <div className={styles.pageHeading}>
        <div><h1>待办</h1><p>队列由服务端根据设备心跳、验真、合同和清理事实生成。同一根因只出现一次，页面不会伪造处理状态。</p></div>
        <button className={styles.secondaryAction} onClick={() => void load()} type="button">刷新待办</button>
      </div>
      <section className={styles.taskMetrics} aria-label="待办优先级统计">
        <div><span>P0 · 立即处理</span><strong>{counts.P0}</strong></div>
        <div><span>P1 · 优先处理</span><strong>{counts.P1}</strong></div>
        <div><span>P2 · 可优化</span><strong>{counts.P2}</strong></div>
        <div><span>更新时间</span><strong>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(generatedAt))}</strong></div>
      </section>
      <section className={styles.dataSection} aria-labelledby="task-list-title">
        <header className={styles.panelHeader}><h2 id="task-list-title">当前待办</h2><span>{tasks.length} 项</span></header>
        <div className={styles.taskList}>
          {tasks.length ? tasks.map((task) => (
            <Link href={task.href} key={task.id}>
              <span className={`${styles.taskPriority} ${task.priority === "P0" ? styles.taskPriorityCritical : task.priority === "P1" ? styles.taskPriorityWarning : ""}`}>{task.priority}</span>
              <span><strong>{task.title}</strong><small>{deviceNames.get(task.deviceId) ?? task.deviceId} · {task.description}</small></span>
              <b>处理 →</b>
            </Link>
          )) : <div className={styles.taskEmpty}><strong>当前没有待办</strong><p>设备没有检测到需要供应商处理的离线、验真、挂牌或履约问题。</p><Link className={styles.secondaryAction} href="/supply/devices">返回托管设备</Link></div>}
        </div>
      </section>
    </>
  );
}
