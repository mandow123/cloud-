import type { Metadata } from "next";
import Link from "next/link";
import { LiveHomeMarketHero } from "@/components/live-home-market-hero";
import { serviceAliases } from "@/lib/data";
import { marketIndexChange, readMarketSnapshot } from "@/lib/server/market-snapshot";

export const metadata: Metadata = {
  title: "算力行情与资源撮合",
  description: "每天查看 GPU、模型 Token、整机柜与云厂商行情，并发布租赁、采购或置换需求。",
};

const quickActions = [
  { code: "01", title: "租 GPU", copy: "H20、A800 等卡时与服务器时", href: "/resources?category=gpu&deal=rental" },
  { code: "02", title: "买 Token", copy: "逐模型比较输入、缓存与输出价", href: "/market#model-token-market" },
  { code: "03", title: "找机柜", copy: "整机柜、功率与预留容量", href: "/resources?category=rack_capacity" },
  { code: "04", title: "做置换", copy: "我可提供 / 我需要双边撮合", href: "/request?mode=swap" },
];

const quoteRows = [
  { spec: "H20 / 96 GB", region: "华北", price: "¥12.80", unit: "卡时", category: "gpu", deal: "rental", change: "-2.1%", status: "可询价" },
  { spec: "A800 / 80 GB", region: "华东", price: "¥9.60", unit: "卡时", category: "gpu", deal: "rental", change: "+0.8%", status: "可询价" },
  { spec: "推理容量 / 1M TPM", region: "全国", price: "¥46.00", unit: "预留容量时", category: "token_model", deal: "service", change: "-1.4%", status: "可撮合" },
  { spec: "20 kW 独占机柜", region: "华南", price: "¥13,800", unit: "机柜月", category: "rack_capacity", deal: "rental", change: "+1.2%", status: "需排期" },
];

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
        }}
      />

      <section className="quick-decision" aria-labelledby="quick-decision-title">
        <div className="shell">
          <div className="section-top">
            <div>
              <p className="kicker">Choose a task</p>
              <h2 className="section-heading" id="quick-decision-title">你今天要解决什么？</h2>
            </div>
            <p>四个入口直达价格或需求，不必先理解平台架构。</p>
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
            <p className="kicker">Market snapshot</p>
            <h2 className="section-heading" id="market-snapshot-title">今日关键报价</h2>
            <p className="section-lead">每条价格都带资源规格、地区、计价单位和可响应状态。</p>
          </div>
          <Link className="button button-secondary" href="/market">全部行情</Link>
        </div>
        <div className="data-table-wrap snapshot-table-wrap">
          <table className="data-table snapshot-table">
            <thead>
              <tr><th>规格</th><th>地区</th><th className="num">P50 参考价</th><th>单位</th><th className="num">7 日变化</th><th>状态</th><th><span className="sr-only">操作</span></th></tr>
            </thead>
            <tbody>
              {quoteRows.map((row) => (
                <tr key={row.spec}>
                  <th scope="row">{row.spec}</th>
                  <td>{row.region}</td>
                  <td className="snapshot-price num">{row.price}</td>
                  <td>{row.unit}</td>
                  <td className="num text-[var(--accent)]">{row.change}</td>
                  <td><span className="availability">{row.status}</span></td>
                  <td><Link className="table-action" href={`/request?${new URLSearchParams({
                    category: row.category,
                    deal: row.deal,
                    unit: row.unit,
                    title: row.spec,
                    region: row.region,
                  }).toString()}`}>按此发布需求</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="data-footnote">基础设施演示参考价 · 非实时成交价 · 模型行情每日北京时间 06:00 更新 · 含税、电费和网络口径以资源详情为准</p>
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
