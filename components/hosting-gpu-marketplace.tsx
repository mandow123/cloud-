"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicHostingOffer, PublicHostingTransactionAvailability } from "@/lib/hosting-v2-client";
import { formatCardHours, formatHostingTime, parseHostingTransactionAvailability } from "@/lib/hosting-v2-client";
import { MarketplaceApiError, marketplaceErrorMessage, marketplaceGet } from "@/lib/client/marketplace-client";
import styles from "./hosting-marketplace.module.css";

export function HostingGpuMarketplace() {
  const [offers, setOffers] = useState<PublicHostingOffer[] | null>(null);
  const [model, setModel] = useState("ALL");
  const [sort, setSort] = useState("PRICE");
  const [error, setError] = useState<string | null>(null);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const [transaction, setTransaction] = useState<PublicHostingTransactionAvailability | null>(null);

  useEffect(() => {
    let cancelled = false;
    void marketplaceGet<{ records: PublicHostingOffer[] }>("/api/v2/offers")
      .then((result) => {
        if (!cancelled) {
          setMarketOpen(true);
          setOffers(result.records);
          setTransaction(parseHostingTransactionAvailability((result as typeof result & { transaction?: unknown }).transaction));
        }
      })
      .catch((cause) => {
        if (cancelled) return;
        if (cause instanceof MarketplaceApiError && cause.code === "HOSTING_V2_DISABLED") {
          setMarketOpen(false);
          setOffers([]);
          setTransaction(null);
          return;
        }
        setError(marketplaceErrorMessage(cause, "GPU 市场暂时无法读取。"));
      });
    return () => { cancelled = true; };
  }, []);

  const records = useMemo(() => {
    const filtered = (offers ?? []).filter((offer) => model === "ALL" || offer.gpuModel === model);
    return [...filtered].sort((left, right) => sort === "PRICE"
      ? left.pricing.cardHourMicrosPerGpuHour - right.pricing.cardHourMicrosPerGpuHour
      : Date.parse(left.availableUntil) - Date.parse(right.availableUntil));
  }, [model, offers, sort]);

  return (
    <div className={styles.market}>
      <header className={styles.marketHeader}>
        <div><p className={styles.eyebrow}>KAI VERIFIED GPU MARKET</p><h1>GPU 算力市场</h1><p>报价、可用时间和交付模板在成交时冻结；租用统一使用 KAI 标准卡时。</p></div>
        <div className={styles.headerActions}><Link href="/gpu/contracts">我的租赁</Link><Link className={styles.primary} href="/hosting/personal-gpu">上架 GPU</Link></div>
      </header>

      <section className={styles.rateBar} aria-label="市场计价说明">
        <span>统一计价：KAI 标准卡时 / GPU 小时</span><span>{transaction?.ready ? "最低租用 3 分钟 · 按秒计量 · 余额先锁定" : "市场可浏览 · 交易写入保持关闭"}</span>
      </section>

      {marketOpen === true && transaction && !transaction.ready ? <section className={styles.tradeClosed} role="status"><strong>仅浏览 · 交易关闭</strong><span>{transaction.message}</span><small>报价、验真和价格可查看；关键 readiness 全部通过后，购买入口才会开放。</small></section> : null}

      <section className={styles.toolbar} aria-label="GPU 筛选">
        <label><span>GPU 型号</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="ALL">全部型号</option><option value="RTX_4090">RTX 4090</option><option value="H100_80GB">H100 80GB</option><option value="H100_94GB">H100 94GB</option></select></label>
        <label><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="PRICE">卡时价格优先</option><option value="WINDOW">可用窗口优先</option></select></label>
        <div className={styles.marketCount}><strong>{records.length}</strong><span>个{transaction?.ready ? "当前可成交" : "可浏览"}报价</span></div>
      </section>

      {error ? <section className={styles.error} role="alert"><strong>市场读取失败</strong><span>{error}</span></section> : null}
      {marketOpen === false ? <section className={styles.error} role="status"><strong>GPU 市场尚未开放</strong><span>统一身份、真实 Agent、费率、交付镜像、计量与清理全部就绪前，平台不会展示或接受成交。</span></section> : null}
      {!offers && !error ? <div className={styles.loading} role="status">正在读取经过验真的 GPU 报价…</div> : null}
      {offers ? (
        <section className={styles.offerTable} aria-label={transaction?.ready ? "可成交 GPU 报价" : "仅浏览 GPU 报价"}>
          <div className={styles.tableHead}><span>资源</span><span>区域与可用时间</span><span>交付标准</span><span>卡时价格</span><span>操作</span></div>
          {records.map((offer) => (
            <article className={styles.offerRow} key={offer.id}>
              <div><span className={styles.verified}>KAI VERIFIED</span><h2>{offer.title}</h2><small>{offer.gpuModel} · 单卡独享</small></div>
              <div><strong>{offer.region}</strong><small>{formatHostingTime(offer.availableFrom)} 至 {formatHostingTime(offer.availableUntil)}</small></div>
              <div><strong>SSH · 审核 OCI 模板</strong><small>{Math.ceil(offer.minRentalSeconds / 60)}–{Math.floor(offer.maxRentalSeconds / 60)} 分钟</small></div>
              <div><strong>{formatCardHours(offer.pricing.cardHourMicrosPerGpuHour)}</strong><small>KAI 标准卡时 / GPU 小时</small></div>
              <Link className={styles.rowAction} href={`/gpu/offers/${encodeURIComponent(offer.id)}`}>{transaction?.ready ? "查看并租用" : "查看报价"}</Link>
            </article>
          ))}
          {!records.length ? <div className={styles.empty}>当前没有符合条件且验真有效的 GPU 报价。</div> : null}
        </section>
      ) : null}
    </div>
  );
}
