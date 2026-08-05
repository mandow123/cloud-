import type { Metadata } from "next";
import Link from "next/link";
import { LiveHomeMarketHero } from "@/components/live-home-market-hero";
import { resourceListings, serviceAliases } from "@/lib/data";
import { formatPrice } from "@/lib/market";
import { marketIndexChange, readMarketSnapshot } from "@/lib/server/market-snapshot";
import type { ResourceCategory, ResourceListing } from "@/lib/types";

export const metadata: Metadata = {
  title: "算力行情与资源撮合",
  description: "每天查看 GPU、模型 Token、整机柜与云厂商行情，并发布租赁、采购或置换需求。",
};

const quickActions = [
  { code: "01", title: "查价格", copy: "GPU、模型 Token、机柜容量分项行情", href: "/market" },
  { code: "02", title: "买 / 租算力", copy: "按型号、地区、交付周期发布采购需求", href: "/request?mode=rental" },
  { code: "03", title: "登记出售", copy: "供应方登记可供容量并响应市场需求", href: "/member?role=supplier#supply-register" },
  { code: "04", title: "发起置换", copy: "分别填写可提供资源与所需资源", href: "/request?mode=swap" },
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

function serviceHref(alias: (typeof serviceAliases)[number]) {
  const params = new URLSearchParams({
    category: alias.category,
    deal: alias.dealMode,
    unit: alias.pricingUnit,
  });
  return `/resources?${params.toString()}`;
}

const serviceGroups = [
  {
    key: "procurement",
    title: "租赁与服务采购",
    note: "7 个入口",
    entries: serviceAliases.filter((alias) => alias.dealMode !== "swap"),
  },
  {
    key: "swap",
    title: "资源置换",
    note: "3 个入口",
    entries: serviceAliases.filter((alias) => alias.dealMode === "swap"),
  },
] as const;

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

      <section className="quick-decision" aria-labelledby="quick-decision-title">
        <div className="shell">
          <div className="section-top">
          <div>
              <p className="kicker">交易入口</p>
              <h2 className="section-heading" id="quick-decision-title">选择交易动作</h2>
            </div>
            <p>行情、采购、出售和置换，从实际任务直接进入。</p>
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

      <section className="shell market-snapshot" aria-labelledby="market-snapshot-title">
        <div className="section-top">
          <div>
            <p className="kicker">当日行情</p>
            <h2 className="section-heading" id="market-snapshot-title">今日关键报价</h2>
            <p className="section-lead">按 P50 展示四类资源，计价口径、样本量和有效期随报价列出。</p>
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
              <tr><th>资源 / 编号</th><th>地区</th><th className="num">市场参考报价</th><th>税费 / 电费 / 网络</th><th>样本 / 时效</th><th>操作</th></tr>
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

      <section className="service-section" aria-labelledby="service-entry-title">
        <div className="shell service-layout">
          <div className="service-intro">
            <p className="kicker">业务名称索引</p>
            <h2 className="section-heading" id="service-entry-title">租赁、服务与置换</h2>
            <p>每个入口已经带上资源类型、交易方式和计价单位，可直接筛选资源。</p>
          </div>
          <div className="service-groups">
            {serviceGroups.map((group) => (
              <section className="service-group" aria-labelledby={`service-group-${group.key}`} key={group.key}>
                <header>
                  <h3 id={`service-group-${group.key}`}>{group.title}</h3>
                  <span>{group.note}</span>
                </header>
                <div className="service-list">
                  {group.entries.map((alias, index) => (
                    <Link href={serviceHref(alias)} key={alias.slug}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <span><strong>{alias.label}</strong><small>{alias.pricingUnit}</small></span>
                      <em>→</em>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>

      <section className="shell action-close" aria-labelledby="action-close-title">
        <div>
          <p className="kicker">下一步</p>
          <h2 id="action-close-title">提交采购或置换需求</h2>
          <p>填写资源型号、地区、数量和交付时间；提交后在交易工作台查看报价进度。</p>
        </div>
        <div>
          <Link className="button button-primary" href="/request">发布采购需求</Link>
          <Link className="button button-secondary" href="/member">查看交易工作台</Link>
        </div>
      </section>
    </>
  );
}
