"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import type { MemberCatalogPurchaseIntent } from "@/lib/server/admin-store";
import styles from "@/components/member-purchase-intents.module.css";

type ListPayload = { records?: MemberCatalogPurchaseIntent[] };
type DetailPayload = { record?: MemberCatalogPurchaseIntent };

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusLabel() {
  return "等待平台人工确认与交付";
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? "算力申请暂时无法读取。");
  return payload as T;
}

export function MemberPurchaseIntentList({ compact = false }: { compact?: boolean }) {
  const [records, setRecords] = useState<MemberCatalogPurchaseIntent[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    loadJson<ListPayload>("/api/v1/member/purchase-intents")
      .then((payload) => { if (!cancelled) setRecords(Array.isArray(payload.records) ? payload.records : []); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "算力申请暂时无法读取。"); });
    return () => { cancelled = true; };
  }, []);
  const visible = compact ? records?.slice(0, 3) : records;
  return <section className={styles.section} aria-labelledby={compact ? "member-compute-title" : "member-purchases-title"}>
    <div className={styles.head}>
      <div><p className={styles.eyebrow}>My compute requests</p><h2 id={compact ? "member-compute-title" : "member-purchases-title"}>{compact ? "我的算力申请" : "算力申请记录"}</h2><p className={styles.meta}>只显示当前交易主体提交的资源快照和人工交付进度。</p></div>
      {compact ? <Link className="button button-secondary" href="/member/purchases">查看全部</Link> : <Link className="button button-primary" href="/buy">继续选择算力</Link>}
    </div>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {!error && records === null ? <p className={styles.empty} role="status">正在读取算力申请…</p> : null}
    {!error && records?.length === 0 ? <div className={styles.empty}><strong>还没有算力申请</strong><p>从 GPU 套餐中选择资源并提交询价后，完整快照会保存在这里。</p><Link href="/buy">查看 GPU 套餐 →</Link></div> : null}
    {visible?.length ? <div className={styles.grid}>{visible.map((record) => <article className={styles.card} key={record.demandId}>
      <div><div className={styles.identity}>{record.resource.supplierLogoUrl ? <Image className={styles.logo} alt={record.resource.supplierName} height={40} src={record.resource.supplierLogoUrl} width={40} /> : null}<div><span className={styles.eyebrow}>{record.demandId}</span><h3 className={styles.title}>{record.resource.title}</h3><p className={styles.meta}>{record.resource.supplierName}</p></div></div></div>
      <div><span className={styles.status}>{statusLabel()}</span><p className={styles.meta}>{record.request.quantity} 套 · 共 {record.request.totalGpuCount} 张 GPU</p></div>
      <div className={styles.amount}>{formatCardHourDisplayMicros(record.pricing.estimatedCardHourMicros)} 卡时<small>询价参考 · 尚未扣卡时</small></div>
      <Link className="button button-primary" href={`/member/purchases/${encodeURIComponent(record.demandId)}`}>查看详情</Link>
    </article>)}</div> : null}
  </section>;
}

export function MemberPurchaseIntentDetail({ demandId }: { demandId: string }) {
  const [record, setRecord] = useState<MemberCatalogPurchaseIntent | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    loadJson<DetailPayload>(`/api/v1/member/purchase-intents/${encodeURIComponent(demandId)}`)
      .then((payload) => { if (!cancelled && payload.record) setRecord(payload.record); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "算力申请暂时无法读取。"); });
    return () => { cancelled = true; };
  }, [demandId]);
  if (error) return <div className={`shell ${styles.detail}`}><Link className={styles.back} href="/member/purchases">← 返回算力申请</Link><p className={styles.error} role="alert">{error}</p></div>;
  if (!record) return <div className={`shell ${styles.detail}`}><p className={styles.empty} role="status">正在读取算力详情…</p></div>;
  return <div className={`shell ${styles.detail}`}>
    <Link className={styles.back} href="/member/purchases">← 返回算力申请</Link>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>Compute request detail · {record.demandId}</p><h1>{record.resource.title}</h1><div className={styles.identity}>{record.resource.supplierLogoUrl ? <Image className={styles.logo} alt={record.resource.supplierName} height={40} src={record.resource.supplierLogoUrl} width={40} /> : null}<strong>{record.resource.supplierName}</strong></div></div>
      <span className={styles.status}>{statusLabel()}</span>
    </header>
    <p className={styles.warning}>这是提交时冻结的询价快照：尚未锁定库存、尚未付款、尚未扣卡时，也不会自动操作供应商机器。平台确认正式报价并完成人工交付后，再进入后续验收与结算。</p>
    <div className={styles.detailGrid}>
      <section className={styles.panel}><h2>申请范围</h2><dl className={styles.facts}>
        <div><dt>套餐数量</dt><dd>{record.request.quantity} 套</dd></div><div><dt>GPU 总数</dt><dd>{record.request.totalGpuCount} 张</dd></div><div><dt>GPU 规格</dt><dd>{record.resource.gpuDescription}</dd></div><div><dt>租用时长</dt><dd>{record.request.durationHours ? `${record.request.durationHours} 小时` : "按正式方案确认"}</dd></div><div><dt>期望交付日</dt><dd>{record.request.deliveryDate ?? "待确认"}</dd></div><div><dt>提交时间</dt><dd>{dateTime(record.createdAt)}</dd></div>
      </dl></section>
      <section className={styles.panel}><h2>卡时参考</h2><dl className={styles.facts}>
        <div><dt>参考单价</dt><dd>{formatCardHourDisplayMicros(record.pricing.unitCardHourMicros)} 卡时 / {record.pricing.pricingUnit}</dd></div><div><dt>预计总计</dt><dd>{formatCardHourDisplayMicros(record.pricing.estimatedCardHourMicros)} 卡时</dd></div><div><dt>资金状态</dt><dd>尚未扣卡时</dd></div><div><dt>价格口径</dt><dd>以人工确认后的正式报价为准</dd></div>
      </dl></section>
      <section className={styles.panel}><h2>资源与交付</h2><dl className={styles.facts}>
        <div><dt>服务范围</dt><dd>{record.resource.region}</dd></div><div><dt>交付形态</dt><dd>{record.resource.deliveryForm}</dd></div><div><dt>交付时效</dt><dd>{record.resource.deliveryLeadTime}</dd></div><div><dt>容量状态</dt><dd>{record.resource.capacity}</dd></div><div><dt>服务说明</dt><dd>{record.resource.sla}</dd></div><div><dt>SSH 公钥指纹</dt><dd className={styles.fingerprint}>{record.sshPublicKeyFingerprint ?? "此申请未收集 SSH 公钥"}</dd></div>
      </dl></section>
      <section className={styles.panel}><h2>人工交付进度</h2><dl className={styles.facts}>
        <div><dt>当前状态</dt><dd>{statusLabel()}</dd></div><div><dt>下一步</dt><dd>平台确认库存、正式卡时报价与机器网络条件</dd></div><div><dt>连接信息</dt><dd>人工交付完成后提供</dd></div><div><dt>自动化状态</dt><dd>未启用自动验真或自动开通</dd></div>
      </dl></section>
      <section className={`${styles.panel} ${styles.wide}`}><h2>提交时资源规格</h2><dl className={styles.specs}>{Object.entries(record.resource.specs).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{record.resource.sourceNotice ? <p className={styles.meta}>{record.resource.sourceNotice}</p> : null}</section>
    </div>
  </div>;
}
