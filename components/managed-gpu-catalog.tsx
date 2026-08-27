"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import { formatMoneyMinor, formatUtilizationBps, readManagedGpuJson, type ManagedGpuCatalogEnvelope } from "@/lib/managed-gpu-client";
import styles from "./managed-gpu.module.css";

export function ManagedGpuCatalog() {
  const [catalog, setCatalog] = useState<ManagedGpuCatalogEnvelope | null>(null);
  const [error, setError] = useState("");
  const [model, setModel] = useState("ALL");

  useEffect(() => {
    const controller = new AbortController();
    readManagedGpuJson<ManagedGpuCatalogEnvelope>("/api/v1/managed-gpu/catalog", controller.signal)
      .then(setCatalog)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "GPU 云托管目录暂时无法读取。");
      });
    return () => controller.abort();
  }, []);

  const models = useMemo(() => Array.from(new Set(catalog?.records.map((record) => record.gpuModel) ?? [])).sort(), [catalog]);
  const records = catalog?.records.filter((record) => model === "ALL" || record.gpuModel === model) ?? [];

  if (error) return <section className={styles.state} role="alert"><h2>目录暂时不可用</h2><p>{error}</p><p>页面不会使用虚构库存或收益数据替代真实服务结果。</p></section>;
  if (!catalog) return <section className={styles.state} role="status">正在读取经审核的实体 GPU 商品…</section>;
  if (!catalog.enabled) return <section className={styles.state}><h2>GPU 云托管尚未开放</h2><p>库存、供应商合同、机房和结算政策全部核验完成后才会开放。</p></section>;

  return <>
    <div className={styles.catalogBar}>
      <label><span>GPU 型号</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="ALL">全部型号</option>{models.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <p><strong>{records.length}</strong> 个经审核商品版本</p>
    </div>
    {!catalog.available ? <div className={styles.notice}><strong>当前只开放目录与报价申请</strong><span>商品不代表实时库存；供应商确认序列号、银行付款和交付条件后才形成实体资产。</span></div> : null}
    {records.length ? <div className={styles.productGrid}>{records.map((record) => {
      const facilityNames = record.facilityIds.map((id) => catalog.facilities.find((facility) => facility.id === id)?.name).filter(Boolean);
      return <article className={styles.productCard} key={record.id}>
        <div className={styles.productHead}><div><p>{record.sellerName}</p><h2>{record.gpuModel}</h2><span>{record.sku} · {record.vramGb === null ? "显存报价时确认" : `${record.vramGb}GB 显存`}</span></div><span className={styles.badge}>整卡确权</span></div>
        <dl className={styles.facts}>
          <div><dt>供应商银行价</dt><dd>{record.unitPriceMinor === null || record.currency === null ? "正式报价时确认" : formatMoneyMinor(record.unitPriceMinor, record.currency)}</dd></div>
          <div><dt>卡时参考</dt><dd>{record.cardHourReferenceMicros === null ? "正式报价时确认" : `${formatCardHourDisplayMicros(record.cardHourReferenceMicros)} 卡时`}</dd></div>
          <div><dt>硬件质保</dt><dd>{record.warrantyMonths === null ? "合同中确认" : `${record.warrantyMonths} 个月`}</dd></div>
          <div><dt>预计交付</dt><dd>{record.estimatedDeliveryDays === null ? "供应商确认" : `${record.estimatedDeliveryDays} 天`}</dd></div>
          <div><dt>托管机房</dt><dd>{facilityNames.join("、") || "报价时确认"}</dd></div>
          <div><dt>交付选择</dt><dd>{record.fulfillmentModes.includes("BEIDOU_HOSTING") ? "北斗机房托管" : ""}{record.fulfillmentModes.length > 1 ? " / " : ""}{record.fulfillmentModes.includes("GLOBAL_SHIPPING") ? "全球寄送" : ""}</dd></div>
        </dl>
        <div className={styles.utilization}><div><span>近 7 日真实利用率</span><strong>{formatUtilizationBps(record.utilization7dBps)}</strong></div><div><span>近 30 日真实利用率</span><strong>{formatUtilizationBps(record.utilization30dBps)}</strong></div></div>
        <p className={styles.truth}>只按真实成交与有效 GPU 秒产生卡时；不承诺固定收益，不支持卡时提现或转让。</p>
        {record.status === "AVAILABLE" ? <Link className={styles.primaryAction} href={`/managed-gpu/configure?product=${encodeURIComponent(record.id)}`}>获取正式报价</Link> : <span className={styles.disabledAction}>库存与合同尚未核验，暂不可提交</span>}
      </article>;
    })}</div> : <section className={styles.state}><h2>当前没有可申请的实体 GPU</h2><p>平台不会在供应商商品和机房条件核验前展示可购买库存。</p></section>}
  </>;
}
