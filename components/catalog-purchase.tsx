"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import styles from "@/components/catalog-purchase.module.css";
import { createIdempotencyKey, marketplaceErrorMessage, marketplacePost } from "@/lib/client/marketplace-client";
import { formatPrice } from "@/lib/market";
import type { MarketplaceRequestRecord } from "@/lib/marketplace";
import type { ResourceListing } from "@/lib/types";

const hourlyUnits = new Set(["卡时", "服务器时", "模型实例时", "预留容量时"]);

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function money(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function CatalogPurchase({ resource }: { resource: ResourceListing }) {
  const [quantity, setQuantity] = useState("1");
  const [durationHours, setDurationHours] = useState("24");
  const [deliveryDate, setDeliveryDate] = useState(tomorrow);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [intent, setIntent] = useState<MarketplaceRequestRecord | null>(null);
  const keyRef = useRef<string | null>(null);
  const usesDuration = hourlyUnits.has(resource.pricingUnit);
  const quantityNumber = Number(quantity);
  const durationNumber = usesDuration ? Number(durationHours) : 1;
  const estimatedAmount = useMemo(
    () => Number.isFinite(quantityNumber) && Number.isFinite(durationNumber) && quantityNumber > 0 && durationNumber > 0
      ? resource.quote.median * quantityNumber * durationNumber
      : 0,
    [durationNumber, quantityNumber, resource.quote.median],
  );

  async function submit() {
    setBusy(true);
    setError("");
    try {
      keyRef.current ??= createIdempotencyKey("catalog-purchase");
      const result = await marketplacePost<MarketplaceRequestRecord>(
        "/api/v1/catalog-purchase-intents",
        {
          resourceId: resource.id,
          quantity: quantityNumber,
          durationHours: usesDuration ? durationNumber : null,
          deliveryDate,
          note,
        },
        keyRef.current,
        20_000,
      );
      keyRef.current = null;
      setIntent(result.record);
    } catch (submitError) {
      setError(marketplaceErrorMessage(submitError, "购买申请提交失败，请检查数量和交付日期后重试。"));
    } finally {
      setBusy(false);
    }
  }

  if (intent) {
    return (
      <div className={`shell ${styles.page}`}>
        <section className={styles.success} aria-labelledby="purchase-success-title">
          <p className={styles.eyebrow}>Purchase request accepted</p>
          <h2 id="purchase-success-title">购买申请已提交</h2>
          <p>申请编号：<strong>{intent.id}</strong></p>
          <p>平台将先核验真实库存、供应商交付条件和正式价格；确认后才会进入付款。当前步骤不会扣款。</p>
          <div className={styles.successActions}>
            <Link className="button button-primary" href="/member">查看交易工作台</Link>
            <Link className="button button-secondary" href="/resources">继续选购资源</Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`shell ${styles.page}`}>
      <Link className={styles.backLink} href="/resources">← 返回资源市场</Link>
      <header className={styles.heading}>
        <p>Purchase capacity</p>
        <h1>确认资源与购买价格</h1>
        <p>价格、资源数量和预计金额放在同一页确认。提交后平台先核验供应商真实库存与正式报价，再进入付款。</p>
      </header>

      <div className={styles.layout}>
        <main className={styles.main}>
          <section className={styles.resourceCard} aria-labelledby="purchase-resource-title">
            <p className={styles.eyebrow}>{resource.region} · {resource.deliveryForm}</p>
            <h2 id="purchase-resource-title">{resource.title}</h2>
            <p>{resource.summary}</p>
            <p className={styles.meta}><span>{resource.supplierName}</span><span>{resource.capacity}</span><span>SLA {resource.sla}</span></p>
            <dl className={styles.specs}>
              {Object.entries(resource.specs).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          </section>

          <section className={styles.formSection} aria-labelledby="purchase-form-title">
            <p className={styles.eyebrow}>Purchase details</p>
            <h2 id="purchase-form-title">填写购买数量</h2>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                资源数量
                <input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
              </label>
              {usesDuration ? (
                <label className={styles.field}>
                  服务时长（小时）
                  <input type="number" min="1" step="1" value={durationHours} onChange={(event) => setDurationHours(event.target.value)} />
                </label>
              ) : null}
              <label className={styles.field}>
                计划开始日期
                <input type="date" min={tomorrow()} value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} />
              </label>
              <label className={`${styles.field} ${styles.wide}`}>
                补充要求（选填）
                <textarea maxLength={500} value={note} placeholder="例如：网络、存储、镜像、专线或交付窗口要求" onChange={(event) => setNote(event.target.value)} />
              </label>
            </div>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </section>
        </main>

        <aside className={styles.summary} aria-label="价格汇总">
          <p className={styles.eyebrow}>Price summary</p>
          <p className={styles.unitPrice}>
            {formatPrice(resource.quote.median, resource.pricingUnit)}
            <span>市场参考单价 · 正式价格以供应商确认为准</span>
          </p>
          <dl className={styles.priceRows}>
            <div><dt>资源数量</dt><dd>{quantityNumber > 0 ? quantityNumber : "—"}</dd></div>
            {usesDuration ? <div><dt>服务时长</dt><dd>{durationNumber > 0 ? `${durationNumber} 小时` : "—"}</dd></div> : null}
            <div><dt>参考价格范围</dt><dd>¥{resource.quote.rangeMin.toLocaleString("zh-CN")}–¥{resource.quote.rangeMax.toLocaleString("zh-CN")}</dd></div>
            <div><dt>预计金额</dt><dd className={styles.estimated}>{estimatedAmount > 0 ? money(estimatedAmount) : "—"}</dd></div>
          </dl>
          <p className={styles.scope}>{resource.quote.scopeNote}</p>
          <ol className={styles.flow}>
            <li>提交购买申请，不立即扣款</li>
            <li>平台确认库存与正式价格</li>
            <li>买方付款后启动服务</li>
            <li>验收后平台结算供应商</li>
          </ol>
          <button className={styles.submit} type="button" disabled={busy || estimatedAmount <= 0 || !deliveryDate} onClick={() => void submit()}>
            <span>{busy ? "正在提交…" : "提交购买"}</span><span aria-hidden="true">→</span>
          </button>
        </aside>
      </div>
    </div>
  );
}
