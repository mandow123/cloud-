"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatCardHourDisplayMicros, formatCardHourValue } from "@/lib/card-hours";
import type { HostingReadinessEnvelope, PublicHostingOffer, PublicHostingReadiness } from "@/lib/hosting-v2-client";
import { formatHostingTime } from "@/lib/hosting-v2-client";
import type { ResourceListing } from "@/lib/types";
import styles from "./buy-workspace.module.css";

type OfferPayload = Readonly<{ records: PublicHostingOffer[] }>;
const MODEL_LABELS: Record<string, string> = { RTX_4090: "RTX 4090", H100_80GB: "H100 80GB", H100_94GB: "H100 94GB" };

function offerModel(value: string) { return MODEL_LABELS[value] ?? value.replaceAll("_", " "); }
function cardHours(micros: number) { try { return formatCardHourDisplayMicros(micros); } catch { return "—"; } }
function sourceDate(listing: ResourceListing) { return listing.source?.observedAt ?? listing.quote.updatedAt.slice(0, 10); }
function packageRate(listing: ResourceListing) { return `${formatCardHourValue(listing.quote.median / 1.002)} 卡时`; }
function packageGpuCount(listing: ResourceListing) {
  const match = listing.specs.GPU?.match(/×\s*(\d+)/u);
  return match ? Number(match[1]) : 1;
}
function modelFamily(listing: ResourceListing) { return listing.title.split("·")[0]?.trim() || listing.specs.GPU || listing.title; }
function listingSearchText(listing: ResourceListing) { return [listing.title, listing.supplierName, listing.region, listing.deliveryForm, ...Object.values(listing.specs)].join(" ").toLocaleLowerCase("zh-CN"); }
function fact(listing: ResourceListing, labels: string[]) { for (const label of labels) if (listing.specs[label]) return listing.specs[label]; return "询价时确认"; }
function responseJson<T>(response: Response): Promise<T | null> { return response.json().catch(() => null) as Promise<T | null>; }

function LiveInventory() {
  const [readiness, setReadiness] = useState<PublicHostingReadiness | null>(null);
  const [offers, setOffers] = useState<PublicHostingOffer[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const readyResponse = await fetch("/api/ready", { cache: "no-store", signal: controller.signal });
        const readyBody = await responseJson<HostingReadinessEnvelope>(readyResponse);
        if (!readyBody?.hostingV2) throw new Error("READINESS_UNAVAILABLE");
        setReadiness(readyBody.hostingV2);
        if (!readyBody.hostingV2.enabled || !readyBody.hostingV2.ready) { setOffers([]); return; }
        const response = await fetch("/api/v2/offers", { cache: "no-store", signal: controller.signal });
        const body = await responseJson<OfferPayload>(response);
        if (!response.ok || !body || !Array.isArray(body.records)) throw new Error("OFFERS_UNAVAILABLE");
        setOffers(body.records);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("实时库存暂时无法读取，供应商询价套餐仍可正常浏览。");
        setOffers([]);
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  if (error) return <p className={styles.inlineNotice} role="status">{error}</p>;
  if (readiness === null || offers === null) return <p className={styles.inlineNotice} role="status">正在读取平台实时库存…</p>;
  if (!readiness.enabled || !readiness.ready || offers.length === 0) return null;
  return <section className={styles.liveSection} aria-labelledby="live-inventory-title">
    <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>PLATFORM INVENTORY</p><h2 id="live-inventory-title">平台实时库存</h2></div><span>{offers.length} 项</span></div>
    <div className={styles.liveList}>{offers.map((offer) => <article key={offer.id}>
      <div><h3>{offer.title}</h3><p>{offerModel(offer.gpuModel)} · {offer.region}</p></div>
      <div><small>可用时间</small><strong>{formatHostingTime(offer.availableFrom)}</strong></div>
      <div><small>卡时 / GPU 小时</small><strong>{cardHours(offer.pricing.cardHourMicrosPerGpuHour)}</strong></div>
      <Link href={`/gpu/offers/${encodeURIComponent(offer.id)}`}>查看库存详情</Link>
    </article>)}</div>
  </section>;
}

export function BuyWorkspace({ inquiryEnabled, primaryListings, referenceLeads, showLiveInventory }: { inquiryEnabled: boolean; primaryListings: readonly ResourceListing[]; referenceLeads: readonly ResourceListing[]; showLiveInventory: boolean }) {
  const [query, setQuery] = useState("");
  const [model, setModel] = useState("ALL");
  const [gpuCount, setGpuCount] = useState("ALL");
  const [sort, setSort] = useState<"PRICE_ASC" | "PRICE_DESC">("PRICE_ASC");
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const models = useMemo(() => Array.from(new Set(primaryListings.map(modelFamily))).sort(), [primaryListings]);
  const visibleListings = useMemo(() => primaryListings
    .filter((listing) => model === "ALL" || modelFamily(listing) === model)
    .filter((listing) => gpuCount === "ALL" || packageGpuCount(listing) === Number(gpuCount))
    .filter((listing) => !normalizedQuery || listingSearchText(listing).includes(normalizedQuery))
    .sort((left, right) => sort === "PRICE_ASC" ? left.quote.median - right.quote.median : right.quote.median - left.quote.median), [gpuCount, model, normalizedQuery, primaryListings, sort]);

  return <div className={styles.page}>
    <header className={styles.hero}><div className={`shell ${styles.heroInner}`}>
      <div><p className={styles.eyebrow}>GPU COMPUTE CATALOG</p><h1>选购 GPU 算力</h1><p>先看清 GPU 套餐、供应商、规格与卡时参考价，再提交询价。平台确认库存和网络条件后安排人工交付。</p></div>
      <nav className={styles.routeLinks} aria-label="购买算力快捷入口"><Link href="/member/purchases">我的算力申请</Link><Link href="/member#card-hours">我的资产</Link><Link href="/request">没有合适套餐？提交需求</Link><Link href="/campaigns/dgx-spark">DGX Spark 专项</Link></nav>
    </div></header>

    <main className={`shell ${styles.workspace}`}>
      <section aria-labelledby="supplier-catalog-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>SUPPLIER GPU PACKAGES</p><h2 id="supplier-catalog-title">供应商 GPU 套餐</h2></div><span>{visibleListings.length} 个套餐</span></div>
        <p className={styles.catalogIntro}>以下为供应商提供的报价套餐。页面价格用于询价参考；提交后不会锁定库存、不会付款，也不代表成交。</p>
        <div className={styles.filters} aria-label="筛选 GPU 套餐">
          <label><span>搜索套餐</span><input type="search" value={query} placeholder="搜索 A100、H100、H200、B200…" onChange={(event) => setQuery(event.target.value)} /></label>
          <label><span>GPU 型号</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="ALL">全部型号</option>{models.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <label><span>每套 GPU 数</span><select value={gpuCount} onChange={(event) => setGpuCount(event.target.value)}><option value="ALL">全部卡数</option><option value="1">1 张</option><option value="2">2 张</option><option value="4">4 张</option></select></label>
          <label><span>价格排序</span><select value={sort} onChange={(event) => setSort(event.target.value as "PRICE_ASC" | "PRICE_DESC")}><option value="PRICE_ASC">卡时从低到高</option><option value="PRICE_DESC">卡时从高到低</option></select></label>
        </div>
        <div className={styles.productGrid}>{visibleListings.map((listing) => <article className={styles.productCard} key={listing.id}>
          <div className={styles.supplierLine}>{listing.supplierLogoUrl ? <Image alt="" className={styles.supplierLogo} height={48} src={listing.supplierLogoUrl} width={48} /> : <span className={styles.logoFallback} aria-hidden="true">K</span>}<div><strong>{listing.supplierName}</strong><span>供应商报价 · {sourceDate(listing)}</span></div></div>
          <div className={styles.productTitle}><p>{listing.deliveryForm} · 人工交付</p><h3>{listing.title}</h3></div>
          <dl className={styles.productFacts}><div><dt>GPU 套餐</dt><dd>{fact(listing, ["GPU"])}</dd></div><div><dt>CPU</dt><dd>{fact(listing, ["CPU", "宿主机CPU", "CPU与内存"])}</dd></div><div><dt>内存</dt><dd>{fact(listing, ["内存", "宿主机内存", "CPU与内存"])}</dd></div><div><dt>存储</dt><dd>{fact(listing, ["存储", "硬盘", "套餐硬盘"])}</dd></div></dl>
          <div className={styles.deliveryFacts}><p><span>服务范围</span><strong>{listing.region}</strong></p><p><span>地域与网络</span><strong>{fact(listing, ["地域与网络", "实际机房地域"])}</strong></p><p><span>交付方式</span><strong>{listing.deliveryLeadTime}</strong></p></div>
          <div className={styles.priceLine}><div><span>询价参考</span><strong>{packageRate(listing)}</strong><small>每套 · 每小时（{packageGpuCount(listing)} 张 GPU）</small></div><div className={styles.cardActions}><Link href={`/resources/${encodeURIComponent(listing.id)}`}>查看详情</Link>{inquiryEnabled ? <Link className={styles.primaryAction} href={`/checkout/${encodeURIComponent(listing.id)}`}>登录询价</Link> : <span className={styles.disabledAction} aria-disabled="true">人工询价维护中</span>}</div></div>
        </article>)}</div>
        {visibleListings.length === 0 ? <div className={styles.empty}>没有符合当前筛选的套餐，请更换型号或搜索词。</div> : null}
      </section>

      {showLiveInventory ? <LiveInventory /> : null}

      <details className={styles.leadDirectory}>
        <summary><span><strong>更多供应商资源线索</strong><small>{referenceLeads.length} 家报价线索，可用于提交定制需求</small></span><span aria-hidden="true">展开查看 ＋</span></summary>
        <div className={styles.leadNotice}>这些条目来自供应商报价资料，仅作需求线索，不代表当前库存或可购买套餐。如有兴趣，请提交算力需求，由平台重新确认。</div>
        <div className={styles.leadGrid}>{referenceLeads.map((listing) => <article key={listing.id}><div><strong>{listing.supplierName}</strong><h3>{listing.title}</h3><p>{listing.region} · {listing.deliveryForm} · {sourceDate(listing)}</p></div><Link href={`/request?listing=${encodeURIComponent(listing.id)}`}>提交相关需求</Link></article>)}</div>
      </details>
    </main>
  </div>;
}
