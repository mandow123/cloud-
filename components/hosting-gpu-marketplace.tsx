"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicHostingOffer } from "@/lib/hosting-v2-client";
import { formatCardHours, formatHostingTime } from "@/lib/hosting-v2-client";
import { marketplaceErrorMessage, marketplaceGet } from "@/lib/client/marketplace-client";
import styles from "./hosting-marketplace.module.css";

export function HostingGpuMarketplace() {
  const [offers, setOffers] = useState<PublicHostingOffer[] | null>(null);
  const [model, setModel] = useState("ALL");
  const [sort, setSort] = useState("PRICE");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void marketplaceGet<{ records: PublicHostingOffer[] }>("/api/v2/offers")
      .then((result) => { if (!cancelled) setOffers(result.records); })
      .catch((cause) => { if (!cancelled) setError(marketplaceErrorMessage(cause, "GPU 市场暂时无法读取。")); });
    return () => { cancelled = true; };
  }, []);

  const records = useMemo(() => {
    const filtered = (offers ?? []).filter((offer) => model === "ALL" || offer.gpuModel === model);
    return [...filtered].sort((left, right) => sort === "PRICE"
      ? left.pricing.cardHourMicrosPerGpuHour - right.pricing.cardHourMicrosPerGpuHour
      : Date.parse(left.availableUntil) - Date.parse(right.availableUntil));
  }, [model, offers, sort]);

  return (
    <main className={styles.market}>
      <header className={styles.marketHeader}>
        <div><p className={styles.eyebrow}>KAI VERIFIED GPU MARKET</p><h1>GPU 算力市场</h1><p>报价、可用时间和交付模板在成交时冻结；租用统一使用 KAI 标准卡时。</p></div>
        <div className={styles.headerActions}><Link href="/gpu/contracts">我的租赁</Link><Link className={styles.primary} href="/hosting/personal-gpu">上架 GPU</Link></div>
      </header>

      <section className={styles.rateBar} aria-label="市场计价说明">
        <span>固定参考：1 KAI 标准卡时 = ¥1.002</span><span>最低租用 3 分钟 · 按秒计量 · 余额先锁定</span>
      </section>

      <section className={styles.toolbar} aria-label="GPU 筛选">
        <label><span>GPU 型号</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="ALL">全部型号</option><option value="RTX_4090">RTX 4090</option><option value="H100_80GB">H100 80GB</option></select></label>
        <label><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="PRICE">卡时价格优先</option><option value="WINDOW">可用窗口优先</option></select></label>
        <div className={styles.marketCount}><strong>{records.length}</strong><span>个当前可成交报价</span></div>
      </section>

      {error ? <section className={styles.error} role="alert"><strong>市场读取失败</strong><span>{error}</span></section> : null}
      {!offers && !error ? <div className={styles.loading} role="status">正在读取经过验真的 GPU 报价…</div> : null}
      {offers ? (
        <section className={styles.offerTable} aria-label="可成交 GPU 报价">
          <div className={styles.tableHead}><span>资源</span><span>区域与可用时间</span><span>交付标准</span><span>卡时价格</span><span>操作</span></div>
          {records.map((offer) => (
            <article className={styles.offerRow} key={offer.id}>
              <div><span className={styles.verified}>KAI VERIFIED</span><h2>{offer.title}</h2><small>{offer.gpuModel} · 单卡独享</small></div>
              <div><strong>{offer.region}</strong><small>{formatHostingTime(offer.availableFrom)} 至 {formatHostingTime(offer.availableUntil)}</small></div>
              <div><strong>SSH · 审核 OCI 模板</strong><small>{Math.ceil(offer.minRentalSeconds / 60)}–{Math.floor(offer.maxRentalSeconds / 60)} 分钟</small></div>
              <div><strong>{formatCardHours(offer.pricing.cardHourMicrosPerGpuHour)}</strong><small>KAI 标准卡时 / GPU 小时</small></div>
              <Link className={styles.rowAction} href={`/gpu/offers/${encodeURIComponent(offer.id)}`}>查看并租用</Link>
            </article>
          ))}
          {!records.length ? <div className={styles.empty}>当前没有符合条件且验真有效的 GPU 报价。</div> : null}
        </section>
      ) : null}
    </main>
  );
}
