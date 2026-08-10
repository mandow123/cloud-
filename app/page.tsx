import type { Metadata } from "next";
import Link from "next/link";
import { LiveHomeMarketHero } from "@/components/live-home-market-hero";
import { resourceListings, serviceAliases } from "@/lib/data";
import { formatPrice } from "@/lib/market";
import { marketIndexChange, readMarketSnapshot } from "@/lib/server/market-snapshot";
import type { ResourceCategory, ResourceListing } from "@/lib/types";

export const metadata: Metadata = {
  title: "让算力，抵达每一个需要它的时刻",
  description: "连接可信算力供给与真实需求，以 KAI 卡时统一购买 GPU、模型、Token、云主机与企业容量。",
};

const quickActions = [
  { code: "01", title: "租 GPU", copy: "H20、A800 等卡时与服务器时", href: "/resources?category=gpu&deal=rental" },
  { code: "02", title: "买 Token", copy: "逐模型比较输入、缓存与输出价", href: "/market#model-token-market" },
  { code: "03", title: "找机柜", copy: "整机柜、功率与预留容量", href: "/resources?category=rack_capacity" },
  { code: "04", title: "做置换", copy: "我可提供 / 我需要双边撮合", href: "/request?mode=swap" },
];

const HOMEPAGE_QUOTE_CATEGORIES: readonly ResourceCategory[] = [
  "gpu",
  "token_model",
  "rack_capacity",
  "cloud_vendor",
];

const quoteRows = HOMEPAGE_QUOTE_CATEGORIES.map((category) => {
  const listing = resourceListings.find((item) => item.category === category && item.featured);
  if (!listing) throw new Error(`Homepage quote missing for category: ${category}`);
  return listing;
});
const homepageGpuQuote = quoteRows[0];

function pricingScope(listing: ResourceListing) {
  const { quote } = listing;
  return [
    quote.taxIncluded ? "含税" : "未含税",
    quote.energyIncluded ? "含电费" : "未含电费",
    quote.networkIncluded ? "含网络" : "未含网络",
  ].join(" · ");
}

function publicScopeNote(value: string) {
  return value
    .replaceAll("\u6f14\u793a价", "市场参考价")
    .replaceAll("\u6f14\u793a", "参考");
}

function formatBeijingTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function requestHref(listing: ResourceListing) {
  return `/request?${new URLSearchParams({
    listing: listing.id,
    mode: listing.dealModes[0],
    category: listing.category,
    unit: listing.pricingUnit,
    title: listing.title,
    region: listing.region,
  }).toString()}`;
}

const serviceEntries = serviceAliases.map((alias) => {
  const params = new URLSearchParams({
    category: alias.category,
    deal: alias.dealMode,
    unit: alias.pricingUnit,
  });
  return [alias.label, `/resources?${params.toString()}`] as const;
});

export default async function Home() {
  const { snapshot, source } = await readMarketSnapshot();
  return (
    <>
      <LiveHomeMarketHero
        initialSource={source}
        initialSummary={{
          publishedAt: snapshot.publishedAt,
          quoteCount: snapshot.quotes.length,
          indexCurrent: snapshot.index.current,
          indexChange1d: snapshot.index.change1d,
          indexChange7d: marketIndexChange(snapshot, 7),
          indexChange30d: snapshot.index.change30d,
          gpuP50: homepageGpuQuote.quote.median,
          gpuCurrency: homepageGpuQuote.quote.currency,
          gpuPricingUnit: homepageGpuQuote.pricingUnit,
          gpuResourceTitle: homepageGpuQuote.title,
        }}
      />

      <section className="shell market-snapshot" aria-labelledby="market-snapshot-title">
        <div className="section-top">
          <div>
            <p className="kicker">Market snapshot</p>
            <h2 className="section-heading" id="market-snapshot-title">今日关键报价</h2>
            <p className="section-lead">四类资源均直接引用统一目录，价格、口径和时效可追溯到具体资源。</p>
          </div>
          <Link className="button button-secondary" href="/market">全部行情</Link>
        </div>
        <div
          aria-labelledby="market-snapshot-title"
          className="data-table-wrap snapshot-table-wrap"
          role="region"
          tabIndex={0}
        >
          <table className="data-table snapshot-table">
            <thead>
              <tr><th>资源 / 编号</th><th>地区</th><th className="num">市场参考报价</th><th>税费 / 电费 / 网络</th><th>样本 / 时效</th><th><span className="sr-only">操作</span></th></tr>
            </thead>
            <tbody>
              {quoteRows.map((listing) => (
                <tr key={listing.id}>
                  <th scope="row">
                    <Link className="snapshot-resource-link" href={`/resources/${listing.id}`}>{listing.title}</Link>
                    <span className="snapshot-resource-id">{listing.id}</span>
                  </th>
                  <td>{listing.region}</td>
                  <td className="snapshot-price num">
                    <span className="snapshot-currency">{listing.quote.currency}</span>
                    {formatPrice(listing.quote.median, listing.pricingUnit)}
                  </td>
                  <td>
                    <strong>{pricingScope(listing)}</strong>
                    <span className="snapshot-detail">{publicScopeNote(listing.quote.scopeNote)}</span>
                  </td>
                  <td>
                    <strong>样本 {listing.quote.sampleCount} 条</strong>
                    <span className="snapshot-detail">更新 <time dateTime={listing.quote.updatedAt}>{formatBeijingTime(listing.quote.updatedAt)}</time></span>
                    <span className="snapshot-detail">有效至 <time dateTime={listing.quote.validUntil}>{formatBeijingTime(listing.quote.validUntil)}</time></span>
                  </td>
                  <td><Link className="table-action" href={requestHref(listing)}>按此发布需求</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="data-footnote">市场参考报价 · 具体以询价确认为准 · 每日北京时间 06:00 更新 · 平台初始化样本，供应商接入后核验更新</p>
      </section>

      <section className="quick-decision" aria-labelledby="quick-decision-title">
        <div className="shell">
          <div className="section-top">
            <div>
              <p className="kicker">START FROM THE WORKLOAD</p>
              <h2 className="section-heading" id="quick-decision-title">从你的任务开始</h2>
            </div>
            <p>先看可交易资源，再按任务筛选；价格、交付和卡时结算使用同一份订单快照。</p>
          </div>
          <div className="quick-grid">
            {quickActions.map((item) => (
              <Link className="quick-card" href={item.href} key={item.code}>
                <span className="quick-code">{item.code}</span>
                <strong>{item.title}</strong>
                <span>{item.copy}</span>
                <em>进入 →</em>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="service-section" aria-labelledby="service-entry-title">
        <div className="shell service-layout">
          <div>
            <p className="kicker">Ten business entries</p>
            <h2 className="section-heading" id="service-entry-title">十个业务叫法，统一进入一个市场</h2>
            <p className="section-lead">熟悉的名称保留为快捷入口，底层统一映射到资源类型、交易方式与计价单位。</p>
          </div>
          <div className="service-list">
            {serviceEntries.map(([label, href], index) => (
              <Link href={href} key={label}><span>{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong><em>→</em></Link>
            ))}
          </div>
        </div>
      </section>

      <section className="shell action-close" aria-labelledby="action-close-title">
        <div>
          <p className="kicker">From price to action</p>
          <h2 id="action-close-title">看到合适价格，就把需求交给同一套后端。</h2>
          <p>提交后获得服务端需求编号；供应方报价会回流到需求方工作台。</p>
        </div>
        <div>
          <Link className="button button-primary" href="/request">发布算力需求</Link>
          <Link className="button button-secondary" href="/member">打开会员工作台</Link>
        </div>
      </section>
    </>
  );
}
