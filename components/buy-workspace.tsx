"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import type {
  HostingReadinessEnvelope,
  PublicHostingOffer,
  PublicHostingReadiness,
} from "@/lib/hosting-v2-client";
import { formatHostingTime } from "@/lib/hosting-v2-client";
import type { ResourceListing } from "@/lib/types";
import styles from "./buy-workspace.module.css";

const COMPARE_STORAGE_KEY = "kai-cloud-live-offer-compare-v1";
const COMPARE_EVENT = "kai-live-offer-compare-changed";

type CardHourBalance = Readonly<{
  availableMicros: number;
  heldMicros: number;
}>;

type OfferPayload = Readonly<{ records: PublicHostingOffer[] }>;
type BalancePayload = Readonly<{ balance: CardHourBalance }>;

const MODEL_LABELS: Record<string, string> = {
  RTX_4090: "RTX 4090",
  H100_80GB: "H100 80GB",
  H100_94GB: "H100 94GB",
};

function offerModel(value: string) {
  return MODEL_LABELS[value] ?? value.replaceAll("_", " ");
}

function cardHours(micros: number) {
  try {
    return formatCardHourDisplayMicros(micros);
  } catch {
    return "—";
  }
}

function minimumHoldMicros(offer: PublicHostingOffer) {
  const rate = offer.pricing.cardHourMicrosPerGpuHour;
  const seconds = offer.minRentalSeconds;
  if (!Number.isSafeInteger(rate) || rate < 0 || !Number.isSafeInteger(seconds) || seconds < 0) return null;
  const micros = (BigInt(rate) * BigInt(seconds) + 3_599n) / 3_600n;
  const value = Number(micros);
  return Number.isSafeInteger(value) ? value : null;
}

function readCompareIds() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMPARE_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").slice(0, 3)
      : [];
  } catch {
    return [];
  }
}

function saveCompareIds(ids: string[]) {
  const limited = ids.slice(0, 3);
  try {
    window.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(limited));
    window.dispatchEvent(new CustomEvent(COMPARE_EVENT, { detail: limited }));
  } catch {
    // The current page still keeps the selection when browser storage is unavailable.
  }
}

async function responseJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

function isBalance(value: BalancePayload | null): value is BalancePayload {
  return Boolean(
    value
      && Number.isSafeInteger(value.balance?.availableMicros)
      && value.balance.availableMicros >= 0
      && Number.isSafeInteger(value.balance?.heldMicros)
      && value.balance.heldMicros >= 0,
  );
}

function offerSearchText(offer: PublicHostingOffer) {
  return [offer.title, offer.gpuModel, offerModel(offer.gpuModel), offer.region, offer.approvedImage]
    .join(" ")
    .toLocaleLowerCase("zh-CN");
}

function catalogSearchText(listing: ResourceListing) {
  return [
    listing.title,
    listing.region,
    listing.deliveryForm,
    listing.summary,
    listing.supplierName,
    ...listing.tags,
  ].join(" ").toLocaleLowerCase("zh-CN");
}

export function BuyWorkspace({ catalogListings }: { catalogListings: readonly ResourceListing[] }) {
  const [readiness, setReadiness] = useState<PublicHostingReadiness | null>(null);
  const [offers, setOffers] = useState<PublicHostingOffer[] | null>(null);
  const [balance, setBalance] = useState<CardHourBalance | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState(false);
  const [query, setQuery] = useState("");
  const [model, setModel] = useState("ALL");
  const [region, setRegion] = useState("ALL");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareMessage, setCompareMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const sync = () => setCompareIds(readCompareIds());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(COMPARE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(COMPARE_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function loadMarket() {
      try {
        const readyResponse = await fetch("/api/ready", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const readyBody = await responseJson<HostingReadinessEnvelope>(readyResponse);
        if (!readyBody?.hostingV2) throw new Error("HOSTING_READINESS_UNAVAILABLE");
        if (cancelled) return;
        setReadiness(readyBody.hostingV2);

        if (!readyBody.hostingV2.enabled || !readyBody.hostingV2.ready) {
          setOffers([]);
          return;
        }

        const offerResponse = await fetch("/api/v2/offers", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const offerBody = await responseJson<OfferPayload>(offerResponse);
        if (!offerResponse.ok || !offerBody || !Array.isArray(offerBody.records)) {
          throw new Error("HOSTING_OFFERS_UNAVAILABLE");
        }
        if (!cancelled) setOffers(offerBody.records);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!cancelled) {
          setOffers([]);
          setMarketError("真实报价暂时无法读取，请稍后重试。");
        }
      }
    }

    async function loadBalance() {
      try {
        const response = await fetch("/api/v1/member/card-hours", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await responseJson<BalancePayload>(response);
        if (!response.ok || !isBalance(body)) throw new Error("CARD_HOUR_BALANCE_UNAVAILABLE");
        if (!cancelled) setBalance(body.balance);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!cancelled) setBalanceError(true);
      }
    }

    void Promise.all([loadMarket(), loadBalance()]);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadKey]);

  const models = useMemo(
    () => Array.from(new Set((offers ?? []).map((offer) => offer.gpuModel))).sort(),
    [offers],
  );
  const regions = useMemo(
    () => Array.from(new Set((offers ?? []).map((offer) => offer.region))).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [offers],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const filteredOffers = useMemo(() => (offers ?? [])
    .filter((offer) => model === "ALL" || offer.gpuModel === model)
    .filter((offer) => region === "ALL" || offer.region === region)
    .filter((offer) => !normalizedQuery || offerSearchText(offer).includes(normalizedQuery))
    .sort((left, right) => left.pricing.cardHourMicrosPerGpuHour - right.pricing.cardHourMicrosPerGpuHour),
  [model, normalizedQuery, offers, region]);

  const comparedOffers = compareIds
    .map((id) => (offers ?? []).find((offer) => offer.id === id))
    .filter((offer): offer is PublicHostingOffer => Boolean(offer));
  const catalogSuggestions = useMemo(() => {
    const matched = normalizedQuery
      ? catalogListings.filter((listing) => catalogSearchText(listing).includes(normalizedQuery))
      : catalogListings.filter((listing) => listing.featured);
    return matched.slice(0, 4);
  }, [catalogListings, normalizedQuery]);

  const marketReady = Boolean(readiness?.enabled && readiness.ready);

  function toggleCompare(id: string) {
    setCompareIds((current) => {
      if (current.includes(id)) {
        const next = current.filter((value) => value !== id);
        setCompareMessage("");
        saveCompareIds(next);
        return next;
      }
      if (current.length >= 3) {
        setCompareMessage("一次最多保存 3 项对比，请先移除一项。");
        return current;
      }
      const next = [...current, id];
      setCompareMessage("");
      saveCompareIds(next);
      return next;
    });
  }

  function clearCompare() {
    setCompareIds([]);
    setCompareMessage("");
    saveCompareIds([]);
  }

  function reload() {
    setReadiness(null);
    setOffers(null);
    setBalance(null);
    setMarketError(null);
    setBalanceError(false);
    setReloadKey((value) => value + 1);
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={`shell ${styles.heroInner}`}>
          <div>
            <p className={styles.eyebrow}>SIGNED-IN BUYER WORKSPACE</p>
            <h1>购买算力</h1>
            <p>只展示后端当前返回、经过验真且可成交的 GPU 报价；卡时余额来自当前登录交易主体。</p>
          </div>
          <nav className={styles.routeLinks} aria-label="购买工作台快捷入口">
            <Link href="/gpu">GPU 市场</Link>
            <Link href="/member#orders">我的订单</Link>
            <Link href="/member#card-hours">卡时账户</Link>
            <Link href="/resources">资源目录</Link>
            <Link href="/campaigns/dgx-spark">DGX Spark 专项</Link>
          </nav>
        </div>
      </header>

      <div className={`shell ${styles.workspace}`}>
        <section className={styles.statusGrid} aria-label="账户与市场状态">
          <div className={styles.statusCard}>
            <span>真实交易状态</span>
            <strong className={marketReady ? styles.ready : styles.setup}>
              {readiness === null ? "核对中" : marketReady ? "可购买" : "SETUP"}
            </strong>
            <small>{marketReady ? "真实报价可进入合同预留" : readiness ? `当前模式 ${readiness.rolloutMode}，关键能力就绪前保持关闭` : "正在读取 /api/ready"}</small>
          </div>
          <div className={styles.statusCard}>
            <span>可用卡时</span>
            <strong>{balance ? cardHours(balance.availableMicros) : balanceError ? "读取失败" : "读取中"}</strong>
            <small>KAI 标准卡时 · 当前登录交易主体</small>
          </div>
          <div className={styles.statusCard}>
            <span>已冻结卡时</span>
            <strong>{balance ? cardHours(balance.heldMicros) : balanceError ? "读取失败" : "读取中"}</strong>
            <small>订单处理中已锁定，不计入可用余额</small>
          </div>
          <div className={styles.statusActions}>
            <Link className="button button-secondary" href="/member#card-hours">管理卡时</Link>
            {(marketError || balanceError) && <button className="button button-secondary" type="button" onClick={reload}>重新读取</button>}
          </div>
        </section>

        <section className={styles.marketSection} aria-labelledby="live-offers-title">
          <div className={styles.sectionHeading}>
            <div><p className={styles.eyebrow}>LIVE VERIFIED OFFERS</p><h2 id="live-offers-title">当前可成交报价</h2></div>
            <strong>{marketReady ? `${filteredOffers.length} 项` : "交易关闭"}</strong>
          </div>

          {marketError && <div className={styles.error} role="alert">{marketError}</div>}
          {!marketError && readiness && !marketReady && (
            <div className={styles.setupNotice} role="status">
              <strong>SETUP：真实交易尚未开放</strong>
              <span>统一身份、供应主体、真实 Agent、费率、镜像、计量、卡时账本与清理全部就绪前，不展示报价，也不接受成交。</span>
            </div>
          )}
          {!marketError && (readiness === null || offers === null) && <div className={styles.loading} role="status">正在核对市场能力与真实报价…</div>}

          {marketReady && offers !== null && (
            <>
              <div className={styles.filters} aria-label="真实报价筛选">
                <label><span>搜索</span><input type="search" value={query} placeholder="型号、区域或镜像" onChange={(event) => setQuery(event.target.value)} /></label>
                <label><span>GPU 型号</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="ALL">全部型号</option>{models.map((value) => <option value={value} key={value}>{offerModel(value)}</option>)}</select></label>
                <label><span>区域</span><select value={region} onChange={(event) => setRegion(event.target.value)}><option value="ALL">全部区域</option>{regions.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
              </div>

              {compareMessage && <p className={styles.compareMessage} role="status">{compareMessage}</p>}
              {compareIds.length > 0 && (
                <aside className={styles.compareBar} aria-label="已保存对比">
                  <div><strong>本机对比 {compareIds.length} / 3</strong><span>仅保存候选，不锁定报价或库存。</span></div>
                  <div className={styles.compareItems}>{comparedOffers.map((offer) => <button type="button" onClick={() => toggleCompare(offer.id)} key={offer.id}>{offer.title} ×</button>)}</div>
                  <button className={styles.textButton} type="button" onClick={clearCompare}>清空</button>
                </aside>
              )}

              <div className={styles.offerList}>
                {filteredOffers.map((offer) => {
                  const minimumHold = minimumHoldMicros(offer);
                  return (
                    <article className={styles.offerRow} key={offer.id}>
                      <div className={styles.offerIdentity}><span>KAI VERIFIED</span><h3>{offer.title}</h3><small>{offerModel(offer.gpuModel)} · {offer.region}</small></div>
                      <div><span className={styles.fieldLabel}>可用窗口</span><strong>{formatHostingTime(offer.availableFrom)}</strong><small>至 {formatHostingTime(offer.availableUntil)}</small></div>
                      <div><span className={styles.fieldLabel}>租用范围</span><strong>{Math.ceil(offer.minRentalSeconds / 60)}–{Math.floor(offer.maxRentalSeconds / 60)} 分钟</strong><small>审核 OCI 镜像 · SSH 交付</small></div>
                      <div><span className={styles.fieldLabel}>网站价</span><strong>{cardHours(offer.pricing.cardHourMicrosPerGpuHour)}</strong><small>卡时 / GPU 小时 · 最低预锁 {minimumHold === null ? "—" : cardHours(minimumHold)}</small></div>
                      <div className={styles.offerActions}>
                        <label><input type="checkbox" checked={compareIds.includes(offer.id)} onChange={() => toggleCompare(offer.id)} /> 对比</label>
                        <Link href={`/gpu/offers/${encodeURIComponent(offer.id)}`}>核对并租用 →</Link>
                      </div>
                    </article>
                  );
                })}
                {filteredOffers.length === 0 && <div className={styles.empty}>当前没有符合筛选条件且验真有效的报价。</div>}
              </div>
            </>
          )}
        </section>

        <section className={styles.catalog} aria-labelledby="catalog-title">
          <div className={styles.sectionHeading}>
            <div><p className={styles.eyebrow}>CATALOG FOR INQUIRY ONLY</p><h2 id="catalog-title">没有实时供给？按目录提交询价</h2></div>
            <Link href="/resources">浏览全部目录 →</Link>
          </div>
          <div className={styles.catalogNotice}><strong>目录资源需平台核验，不是即时库存。</strong><span>目录仅帮助说明需求与参考口径；实际供应、价格、交付与合同条件以平台核验和供应方确认为准。</span></div>
          <div className={styles.catalogList}>
            {catalogSuggestions.map((listing) => (
              <article key={listing.id}>
                <div><span>{listing.region} · {listing.deliveryForm}</span><h3>{listing.title}</h3></div>
                <div className={styles.catalogActions}><Link href={`/resources/${encodeURIComponent(listing.id)}`}>查看目录</Link><Link href={`/request?listing=${encodeURIComponent(listing.id)}`}>按此模板提交询价</Link></div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
