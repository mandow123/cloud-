"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import { createIdempotencyKey, marketplaceErrorMessage, marketplacePost } from "@/lib/client/marketplace-client";
import {
  managedGpuStatusLabel,
  readManagedGpuJson,
  type ManagedGpuAssetSummary,
  type ManagedGpuCatalogEnvelope,
  type ManagedGpuMemberSummary,
  type ManagedGpuOrderSummary,
  type ManagedGpuQuoteSummary,
  type ManagedGpuRecordsEnvelope,
  type ManagedGpuSettlementSummary,
} from "@/lib/managed-gpu-client";
import styles from "./managed-gpu.module.css";

type DashboardData = Readonly<{
  summary: ManagedGpuMemberSummary;
  orders: readonly ManagedGpuOrderSummary[];
  assets: readonly ManagedGpuAssetSummary[];
  settlements: readonly ManagedGpuSettlementSummary[];
  quotes: readonly ManagedGpuQuoteSummary[];
  catalog: ManagedGpuCatalogEnvelope;
}>;

export function ManagedGpuMemberDashboard({ view = "overview" }: { view?: "overview" | "assets" | "orders" | "earnings" }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [busyQuoteId, setBusyQuoteId] = useState("");
  const [busyFeeId, setBusyFeeId] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    readManagedGpuJson<ManagedGpuMemberSummary>("/api/v1/member/managed-gpu/summary", controller.signal).then(async (summary) => {
      if (!summary.enabled) {
        setData({ summary, orders: [], assets: [], settlements: [], catalog: { enabled: false, available: false, records: [], facilities: [] }, quotes: [] });
        return;
      }
      const [catalog, quotes] = await Promise.all([
        readManagedGpuJson<ManagedGpuCatalogEnvelope>("/api/v1/managed-gpu/catalog", controller.signal),
        readManagedGpuJson<ManagedGpuRecordsEnvelope<ManagedGpuQuoteSummary>>("/api/v1/member/managed-gpu/quotes", controller.signal),
      ]);
      setData({ summary, orders: summary.orders, assets: summary.assets, settlements: summary.settlements, catalog, quotes: quotes.records });
    }).catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "GPU 资产暂时无法读取。");
      });
    return () => controller.abort();
  }, []);
  if (error && !data) return <section className={styles.state} role="alert"><h2>GPU 资产读取失败</h2><p>{error}</p><p>页面不会把接口异常显示为零资产。</p></section>;
  if (!data) return <section className={styles.state} role="status">正在读取当前组织的实体 GPU、订单和结算…</section>;
  const { summary, orders, assets, settlements, catalog } = data;
  if (!summary.enabled) return <section className={styles.state}><h2>当前组织尚未启用 GPU 云托管</h2><p>首期仅向完成企业审核的受邀客户开放。</p><Link className={styles.secondaryAction} href="/managed-gpu">查看产品说明</Link></section>;

  const productLabel = (id: string) => catalog.records.find((record) => record.id === id)?.gpuModel ?? id;
  const sellerLabel = (id: string) => catalog.records.find((record) => record.id === id)?.sellerName ?? "认证供应商";
  const facilityLabel = (id: string | null) => id ? catalog.facilities.find((facility) => facility.id === id)?.name ?? id : "待确定交付位置";

  async function acceptQuote(quote: ManagedGpuQuoteSummary) {
    setBusyQuoteId(quote.id); setError(""); setNotice("");
    try {
      const response = await marketplacePost<ManagedGpuOrderSummary>("/api/v1/member/managed-gpu/orders", { quoteId: quote.id }, createIdempotencyKey("managed-gpu-order"));
      setData((current) => current ? { ...current, quotes: current.quotes.map((item) => item.id === quote.id ? { ...item, status: "ACCEPTED" } : item), orders: [response.record, ...current.orders] } : current);
      setNotice("正式报价已接受，订单已进入供应商银行付款阶段。平台不会在页面内代收硬件购置款。");
    } catch (reason) { setError(marketplaceErrorMessage(reason, "正式报价暂时无法接受，请刷新后重试。")); }
    finally { setBusyQuoteId(""); }
  }

  async function payOutstandingFee(settlement: ManagedGpuSettlementSummary) {
    if (!settlement.outstandingFeeId || settlement.shortfallMicros <= 0) return;
    setBusyFeeId(settlement.outstandingFeeId); setError(""); setNotice("");
    try {
      await marketplacePost(`/api/v1/member/managed-gpu/fees/${encodeURIComponent(settlement.outstandingFeeId)}/pay`, { expectedAmountMicros: settlement.shortfallMicros }, createIdempotencyKey("managed-gpu-hosting-fee"));
      setData((current) => current ? { ...current, settlements: current.settlements.map((item) => item.id === settlement.id ? { ...item, outstandingFeeStatus: "PAID" } : item) } : current);
      setNotice(`已按你的本次授权扣除 ${formatCardHourDisplayMicros(settlement.shortfallMicros)} 卡时，余额不会变为负数。`);
    } catch (reason) { setError(marketplaceErrorMessage(reason, "托管费用暂时无法扣除，请确认可用卡时余额后重试。")); }
    finally { setBusyFeeId(""); }
  }

  return <div>
    <header className={styles.memberHead}><div><p className={styles.eyebrow}>MANAGED GPU ASSETS</p><h1>{view === "assets" ? "我的 GPU" : view === "orders" ? "实体 GPU 购买订单" : view === "earnings" ? "托管产出卡时" : "GPU 云托管总览"}</h1><p>{summary.organizationName ?? summary.organizationId} · 数据严格限定于当前组织</p></div><Link className={styles.primaryAction} href="/managed-gpu">购买实体 GPU</Link></header>
    <nav className={styles.memberNav}><Link href="/member/gpu-assets">我的 GPU</Link><Link href="/member/gpu-hosting/orders">购买订单</Link><Link href="/member/gpu-hosting/earnings">托管产出卡时</Link></nav>
    {error ? <div className={styles.formError} role="alert">{error}</div> : null}
    {notice ? <div className={styles.notice} role="status"><strong>操作已完成</strong><span>{notice}</span></div> : null}
    {view === "overview" || view === "assets" ? <section className={styles.dashboardGrid} aria-label="GPU 资产摘要">
      <article className={`${styles.panel} ${styles.metric}`}><span>实体 GPU</span><strong>{summary.assetCount}</strong><small>{summary.activeAssetCount} 张运营中</small></article>
      <article className={`${styles.panel} ${styles.metric}`}><span>小时暂估</span><strong>{formatCardHourDisplayMicros(summary.provisionalIncomeCardHourMicros)}</strong><small>尚未入账</small></article>
      <article className={`${styles.panel} ${styles.metric}`}><span>已确认卡时</span><strong>{formatCardHourDisplayMicros(summary.confirmedIncomeCardHourMicros)}</strong><small>不可提现、不可转让</small></article>
    </section> : null}
    {view === "overview" || view === "assets" ? <section className={styles.panel}><h2>实体 GPU 资产</h2>{assets.length ? <div className={styles.recordList}>{assets.map((asset) => <article className={styles.record} key={asset.id}><div><h3>{productLabel(asset.productVersionId)}</h3><p>序列号摘要 {asset.serialFingerprint} · {facilityLabel(asset.facilityId)} · Agent {asset.agentBindingId ? "已绑定" : "未绑定"}</p></div><strong>{managedGpuStatusLabel(asset.status)}</strong><Link href={`/member/gpu-assets/${encodeURIComponent(asset.id)}`}>查看资产</Link></article>)}</div> : <p>当前组织还没有完成确权的实体 GPU。</p>}</section> : null}
    {view === "overview" || view === "orders" ? <><section className={styles.panel}><h2>报价申请</h2>{data.quotes.length ? <div className={styles.recordList}>{data.quotes.map((quote) => <article className={styles.record} key={quote.id}><div><h3>{productLabel(quote.productVersionId)}</h3><p>{quote.quantity} 张 · {managedGpuStatusLabel(quote.status)}{quote.totalAmountMinor !== null && quote.issuedCurrency ? ` · ${new Intl.NumberFormat("zh-CN", { style: "currency", currency: quote.issuedCurrency }).format(quote.totalAmountMinor / 100)}` : ""}</p></div><strong>{quote.expiresAt ? `有效至 ${new Date(quote.expiresAt).toLocaleDateString("zh-CN")}` : "等待正式报价"}</strong>{quote.status === "ISSUED" ? <button className={styles.primaryAction} disabled={Boolean(busyQuoteId)} onClick={() => void acceptQuote(quote)} type="button">{busyQuoteId === quote.id ? "处理中…" : "接受正式报价"}</button> : <span>{managedGpuStatusLabel(quote.status)}</span>}</article>)}</div> : <p>当前组织还没有实体 GPU 报价申请。</p>}</section><section className={styles.panel}><h2>购买订单</h2>{orders.length ? <div className={styles.recordList}>{orders.map((order) => <article className={styles.record} key={order.id}><div><h3>{productLabel(order.productVersionId)}</h3><p>{sellerLabel(order.productVersionId)} · {order.quantity} 张 · {order.fulfillmentChoice === "BEIDOU_HOSTING" ? "北斗机房托管" : "全球寄送"}</p></div><strong>{managedGpuStatusLabel(order.status)}</strong><span>{new Date(order.updatedAt).toLocaleDateString("zh-CN")}</span></article>)}</div> : <p>当前组织还没有实体 GPU 购买订单。</p>}</section></> : null}
    {view === "overview" || view === "earnings" ? <section className={styles.panel}><h2>结算记录</h2><p>小时数据为暂估，每日确认，月度审批后才写入卡时账本。</p>{settlements.length ? <div className={styles.recordList}>{settlements.map((settlement) => <article className={styles.record} key={settlement.id}><div><h3>{new Date(settlement.periodStart).toLocaleDateString("zh-CN")} – {new Date(settlement.periodEnd).toLocaleDateString("zh-CN")}</h3><p>毛产出 {formatCardHourDisplayMicros(settlement.grossCardHourMicros)} · 退款/冲正 {formatCardHourDisplayMicros(settlement.refundCardHourMicros)} · 平台费 {formatCardHourDisplayMicros(settlement.platformFeeMicros)} · 磨损 {formatCardHourDisplayMicros(settlement.wearMicros)} · 托管费 {formatCardHourDisplayMicros(settlement.facilityChargeMicros)}</p>{settlement.shortfallMicros > 0 ? <p className={styles.formError}>本期产出不足，待缴 {formatCardHourDisplayMicros(settlement.shortfallMicros)} 卡时{settlement.outstandingFeeDueAt ? `，补缴期至 ${new Date(settlement.outstandingFeeDueAt).toLocaleString("zh-CN")}` : ""}。逾期只暂停该设备参与新算力订单，不影响实体 GPU 所有权。</p> : null}</div><strong>{formatCardHourDisplayMicros(settlement.netCardHourMicros)} 卡时</strong><span>{settlement.outstandingFeeStatus === "PAID" ? "待缴已结清" : managedGpuStatusLabel(settlement.status)}</span>{settlement.outstandingFeeId && settlement.outstandingFeeStatus !== "PAID" ? <button className={styles.secondaryAction} disabled={Boolean(busyFeeId)} onClick={() => void payOutstandingFee(settlement)} type="button">{busyFeeId === settlement.outstandingFeeId ? "扣除中…" : "授权从现有卡时扣除"}</button> : null}</article>)}</div> : <p>暂无已生成的托管结算。</p>}</section> : null}
  </div>;
}
