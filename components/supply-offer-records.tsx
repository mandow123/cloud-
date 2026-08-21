"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getSupplyOffers, supplyApiUnavailable, type SupplyOffer } from "@/components/supply-api-client";
import { marketplaceErrorMessage } from "@/lib/client/marketplace-client";
import styles from "./supply-console.module.css";

const statusLabels: Record<SupplyOffer["status"], string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  UNDER_VERIFICATION: "人工审核中",
  VERIFIED: "审核通过",
  REJECTED: "需要修改",
  PUBLISHED: "已发布",
};

const resourceLabels: Record<SupplyOffer["resourceType"], string> = {
  GPU_CARD: "GPU 显卡",
  GPU_SERVER: "GPU 服务器",
  CPU_SERVER: "CPU 服务器",
  MAC_COMPUTE: "Mac 算力",
  TOKEN_CAPACITY: "Token 容量",
  MODEL_INSTANCE: "模型实例",
  NAS_STORAGE: "NAS 存储",
  RACK_CAPACITY: "机柜容量",
  CLOUD_RESOURCE: "云厂商资源",
};

type TelemetryEligibleSupplyOffer = SupplyOffer & Readonly<{ telemetryConnectionEligible?: boolean }>;

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function SupplyOfferRecords({ telemetryEnabled = false }: { telemetryEnabled?: boolean }) {
  const [records, setRecords] = useState<TelemetryEligibleSupplyOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRecords(await getSupplyOffers() as TelemetryEligibleSupplyOffer[]);
    } catch (cause) {
      setError(supplyApiUnavailable(cause)
        ? "上架申请服务暂时不可用；页面不会生成本地假记录。"
        : marketplaceErrorMessage(cause, "上架申请暂时无法读取。"));
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  if (error) return <section className={styles.error} role="alert"><h2>申请记录读取失败</h2><p>{error}</p><button className={`${styles.secondaryAction} mt-4`} onClick={() => void load()} type="button">重新读取</button></section>;
  if (!records) return <div className={styles.loading} role="status">正在读取当前交易主体的上架申请…</div>;

  const pendingCount = records.filter((record) => ["SUBMITTED", "UNDER_VERIFICATION"].includes(record.status)).length;

  return (
    <>
      <div className={styles.pageHeading}>
        <div><h1>上架申请</h1><p>提交后立即写入服务端数据库，由管理员人工审核；不会自动验真、公开发布、成交或交付。</p></div>
        <Link className={styles.primaryAction} href="/supply/apply">提交新申请</Link>
      </div>

      <div className={styles.metrics}>
        <div className={styles.metric}><span>全部申请</span><strong>{records.length}</strong><small>当前组织</small></div>
        <div className={styles.metric}><span>待处理</span><strong>{pendingCount}</strong><small>已提交或审核中</small></div>
        <div className={styles.metric}><span>审核通过</span><strong>{records.filter((record) => record.status === "VERIFIED").length}</strong><small>仍不会自动发布</small></div>
        <div className={styles.metric}><span>已发布</span><strong>{records.filter((record) => record.status === "PUBLISHED").length}</strong><small>必须由平台人工决定</small></div>
      </div>

      <section className={styles.dataSection} aria-labelledby="supply-offer-records-title">
        <header className={styles.panelHeader}><h2 id="supply-offer-records-title">提交记录</h2><span>{records.length} 条</span></header>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>资源</th><th>数量</th><th>地区 / 交付</th><th>状态</th><th>提交时间</th></tr></thead>
            <tbody>
              {records.length ? records.map((record) => (
                <tr key={record.id}>
                  <td data-label="资源"><strong>{record.productName}</strong><br /><small>{resourceLabels[record.resourceType]} · {record.id}</small><details className="mt-2"><summary>查看规格</summary><p className="mb-0 mt-2 whitespace-pre-wrap text-sm">{record.specification}</p>{record.notes ? <p className="mb-0 mt-2 text-sm text-[var(--muted)]">备注：{record.notes}</p> : null}</details></td>
                  <td data-label="数量">{record.quantity.toLocaleString("zh-CN")}<br /><small>{record.quantityUnit} / {record.pricingUnit}</small></td>
                  <td data-label="地区 / 交付">{record.region}<br /><small>{record.deliveryForm}</small></td>
                  <td data-label="状态">
                    <span className={`${styles.statusBadge} ${record.status === "REJECTED" ? styles.statusError : ["SUBMITTED", "UNDER_VERIFICATION"].includes(record.status) ? styles.statusWarning : ""}`}>{statusLabels[record.status]}</span>
                    {telemetryEnabled && record.telemetryConnectionEligible ? (
                      <Link className={styles.recordAction} href={`/supply/devices/new?applicationId=${encodeURIComponent(record.id)}`}>连接个人 GPU</Link>
                    ) : null}
                  </td>
                  <td data-label="提交时间">{dateTime(record.createdAt)}</td>
                </tr>
              )) : <tr><td className={styles.emptyRow} colSpan={5}>还没有上架申请。提交第一条申请后，记录会保存在服务端数据库并同步进入管理员后台。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
