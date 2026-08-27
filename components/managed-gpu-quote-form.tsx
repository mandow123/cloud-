"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createIdempotencyKey, marketplaceErrorMessage, marketplacePost } from "@/lib/client/marketplace-client";
import { formatMoneyMinor, readManagedGpuJson, type ManagedGpuCatalogEnvelope } from "@/lib/managed-gpu-client";
import styles from "./managed-gpu.module.css";

type QuoteRecord = Readonly<{ id: string; status: string }>;

export function ManagedGpuQuoteForm({ productId }: { productId: string }) {
  const [catalog, setCatalog] = useState<ManagedGpuCatalogEnvelope | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [fulfillmentChoice, setFulfillmentChoice] = useState<"BEIDOU_HOSTING" | "GLOBAL_SHIPPING">("BEIDOU_HOSTING");
  const [destinationCountry, setDestinationCountry] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<QuoteRecord | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    readManagedGpuJson<ManagedGpuCatalogEnvelope>("/api/v1/managed-gpu/catalog", controller.signal).then(setCatalog).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "商品信息暂时无法读取。");
    });
    return () => controller.abort();
  }, []);

  const product = useMemo(() => catalog?.records.find((record) => record.id === productId) ?? null, [catalog, productId]);
  const activeFacility = useMemo(() => catalog?.facilities.find((facility) => facility.status === "ACTIVE" && product?.facilityIds.includes(facility.id)) ?? null, [catalog, product]);
  const selectedFulfillmentChoice = product && fulfillmentChoice === "BEIDOU_HOSTING" && (!product.fulfillmentModes.includes("BEIDOU_HOSTING") || !activeFacility) && product.fulfillmentModes.includes("GLOBAL_SHIPPING") ? "GLOBAL_SHIPPING" : fulfillmentChoice;

  async function submitQuote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product || product.status !== "AVAILABLE" || !acknowledged) return;
    if (selectedFulfillmentChoice === "BEIDOU_HOSTING" && !activeFacility) { setError("北斗机房尚未通过运营验收，当前不能选择托管。"); return; }
    setSubmitting(true); setError("");
    try {
      const response = await marketplacePost<QuoteRecord>("/api/v1/managed-gpu/quotes", {
        productVersionId: product.id,
        quantity,
        fulfillmentChoice: selectedFulfillmentChoice,
        facilityId: selectedFulfillmentChoice === "BEIDOU_HOSTING" ? activeFacility?.id : undefined,
        requestedCurrency: product.currency ?? "CNY",
        destinationCountryCode: selectedFulfillmentChoice === "GLOBAL_SHIPPING" ? destinationCountry.trim().toUpperCase() : undefined,
      }, createIdempotencyKey("managed-gpu-quote"));
      setCreated(response.record);
    } catch (reason) {
      setError(marketplaceErrorMessage(reason, "报价申请提交失败，请核对资料后重试。"));
    } finally { setSubmitting(false); }
  }

  if (!catalog && !error) return <section className={styles.state} role="status">正在读取商品与机房条件…</section>;
  if (catalog && !catalog.enabled) return <section className={styles.state}><h2>GPU 云托管尚未开放</h2><p>库存、供应商合同、机房和结算政策全部核验完成后才会开放。</p><Link className={styles.secondaryAction} href="/managed-gpu">返回产品说明</Link></section>;
  if (error && !product) return <section className={styles.state} role="alert"><h2>无法创建报价申请</h2><p>{error}</p></section>;
  if (!product) return <section className={styles.state}><h2>商品版本不存在或已停止报价</h2><p>请返回云托管目录选择当前有效的商品。</p><Link className={styles.secondaryAction} href="/managed-gpu">返回目录</Link></section>;
  if (created) return <section className={styles.state} role="status"><p className={styles.eyebrow}>QUOTE REQUEST CREATED</p><h2>报价申请已提交</h2><p>编号：{created.id}。平台将进行邀请资格和企业合规审核，随后由供应商提供正式银行报价与合同。</p><Link className={styles.primaryAction} href="/member/gpu-hosting/orders">查看购买订单</Link></section>;

  return <form className={styles.quoteForm} onSubmit={submitQuote}>
    <header><p className={styles.eyebrow}>FORMAL QUOTE REQUEST</p><h1>申请实体 GPU 正式报价</h1><p>{product.sellerName} · {product.gpuModel} · {product.vramGb}GB</p></header>
    <div className={styles.quoteSummary}><div><span>供应商银行参考价</span><strong>{product.unitPriceMinor === null || product.currency === null ? "正式报价时确认" : formatMoneyMinor(product.unitPriceMinor, product.currency)}</strong><small>每张 GPU；最终价格以供应商正式合同为准</small></div><div><span>硬件质保</span><strong>{product.warrantyMonths === null ? "合同中确认" : `${product.warrantyMonths} 个月`}</strong><small>由认证供应商负责</small></div></div>
    <div className={styles.formGrid}>
      <label><span>购买数量</span><input min={1} max={32} required type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
      <label><span>交付方式</span><select value={selectedFulfillmentChoice} onChange={(event) => setFulfillmentChoice(event.target.value as "BEIDOU_HOSTING" | "GLOBAL_SHIPPING")}><option value="BEIDOU_HOSTING" disabled={!product.fulfillmentModes.includes("BEIDOU_HOSTING") || !activeFacility}>北斗机房托管</option><option value="GLOBAL_SHIPPING" disabled={!product.fulfillmentModes.includes("GLOBAL_SHIPPING")}>全球寄送</option></select></label>
      {selectedFulfillmentChoice === "GLOBAL_SHIPPING" ? <label><span>目的国家/地区代码</span><input maxLength={2} minLength={2} pattern="[A-Za-z]{2}" placeholder="例如 US" required value={destinationCountry} onChange={(event) => setDestinationCountry(event.target.value)} /></label> : null}
    </div>
    <div className={styles.contractNotice}><strong>交易与产出口径</strong><ul><li>硬件由供应商直售，付款进入供应商银行账户；KAI 不代收购卡款。</li><li>托管设备必须完成实体序列号确权、机房验收和 KAI Host Agent 验证后才能进入市场。</li><li>只有真实成交才产生卡时；托管产出不可提现、转让或交易。</li><li>本申请不会锁定库存，也不会自动创建付款。</li></ul></div>
    <label className={styles.consent}><input checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} type="checkbox" /><span>我已阅读并理解以上规则，并授权平台联系当前企业主体进行 KYB 与报价审核。</span></label>
    {error ? <p className={styles.formError} role="alert">{error}</p> : null}
    <div className={styles.formActions}><Link className={styles.secondaryAction} href="/managed-gpu">返回目录</Link><button className={styles.primaryAction} disabled={!acknowledged || submitting} type="submit">{submitting ? "正在提交…" : "提交正式报价申请"}</button></div>
  </form>;
}
