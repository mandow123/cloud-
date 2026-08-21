"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { marketplaceErrorMessage, marketplaceGet } from "@/lib/client/marketplace-client";
import type { ManualDeliveryStatus, SupplierManualDeliveryTask } from "@/lib/server/admin-store";
import styles from "./supplier-manual-deliveries.module.css";

const STATUS_LABELS: Record<ManualDeliveryStatus, string> = {
  PENDING_MANUAL_DELIVERY: "待平台分配", SUPPLIER_ASSIGNED: "待开始配置", DELIVERY_IN_PROGRESS: "配置中",
  AWAITING_BUYER_ACCEPTANCE: "等待买家确认", COMPLETED: "买家已确认", CANCELLED: "已取消", ACCESS_REVOKED: "访问已撤销",
};
type Payload = Readonly<{ records: SupplierManualDeliveryTask[]; count?: number }>;

function dateTime(value: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date); }

export function SupplierManualDeliveries() {
  const [records, setRecords] = useState<SupplierManualDeliveryTask[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { const payload = await marketplaceGet<Payload>("/api/v1/supply/manual-deliveries"); setRecords(Array.isArray(payload.records) ? payload.records : []); }
    catch (reason) { setError(marketplaceErrorMessage(reason, "人工交付任务暂时无法读取。")); }
  }, []);
  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load(); }); return () => window.cancelAnimationFrame(frame); }, [load]);

  return <section className={styles.section} aria-labelledby="supplier-manual-delivery-title">
    <header className={styles.head}><div><p>MANUAL DELIVERY</p><h2 id="supplier-manual-delivery-title">分配给本组织的人工交付</h2><span>只显示平台明确分配给当前组织的任务；不包含买家姓名、邮箱、原始公钥或管理员内部备注。</span></div><button className="button button-secondary" onClick={() => void load()} type="button">刷新任务</button></header>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {!error && records === null ? <p className={styles.empty} role="status">正在读取人工交付任务…</p> : null}
    {!error && records?.length === 0 ? <div className={styles.empty}><strong>当前没有分配给本组织的人工交付任务</strong><p>任务由平台管理员核对供应关系后分配，不会因为浏览器角色切换而出现。</p></div> : null}
    {records?.length ? <div className={styles.list}>{records.map((record) => <article className={styles.task} key={record.demandId}>
      <div className={styles.identity}><span>{record.demandId}</span><h3>{record.resource.title}</h3><p>{record.resource.gpuDescription} · {record.request.quantity} 套 / {record.request.totalGpuCount} 张 GPU</p></div>
      <div className={styles.status}><strong>{STATUS_LABELS[record.status]}</strong><span>状态版本 {record.statusVersion}</span><time dateTime={record.updatedAt}>{dateTime(record.updatedAt)}</time></div>
      <dl className={styles.facts}><div><dt>服务范围</dt><dd>{record.resource.region}</dd></div><div><dt>期望交付日</dt><dd>{record.request.deliveryDate ?? "待平台协调"}</dd></div><div><dt>租用时长</dt><dd>{record.request.durationHours ? `${record.request.durationHours} 小时` : "待确认"}</dd></div><div><dt>买家公钥指纹</dt><dd className={styles.fingerprint}>{record.sshPublicKeyFingerprint ?? "尚未收集"}</dd></div><div><dt>开始配置</dt><dd>{dateTime(record.deliveryTimeline.startedAt)}</dd></div></dl>
      <p className={styles.boundary}>本页不展示买家身份、SSH 原始公钥、连接地址或平台内部备注。配置操作由平台管理员协调并记录。</p>
    </article>)}</div> : null}
    <footer className={styles.footer}><span>需要补充供应资源或交付能力？</span><Link href="/supply/apply">提交上架申请 →</Link></footer>
  </section>;
}
