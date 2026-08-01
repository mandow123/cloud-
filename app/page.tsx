import type { Metadata } from "next";
import Link from "next/link";
import { serviceAliases } from "@/lib/data";

export const metadata: Metadata = {
  title: "算力行情与资源撮合",
  description:
    "KAI Cloud 聚合 GPU、Token、模型容量、整机柜与云厂商资源，以演示行情支持算力租赁和置换决策。",
};

const trend = [
  98.4, 99.1, 98.8, 99.6, 100.2, 100.8, 101.4, 100.9, 101.8, 102.1,
  101.7, 102.6, 103.2, 102.9, 103.8, 104.1, 103.7, 104.6, 104.3, 105.1,
  104.8, 105.4, 105.9, 105.5, 106.2, 106.6, 106.1, 106.8, 107.2, 107.6,
];

const quoteRows = [
  { spec: "H20 / 96 GB", region: "华北", price: "¥ 12.80", unit: "卡时", change: "-2.1%", sample: 42, scope: "含税 · 含电 · 网络另计", updatedAt: "18:40" },
  { spec: "A800 / 80 GB", region: "华东", price: "¥ 9.60", unit: "卡时", change: "+0.8%", sample: 36, scope: "含税 · 含电 · 含基础网络", updatedAt: "18:37" },
  { spec: "推理容量 / 1M TPM", region: "全国", price: "¥ 46.00", unit: "预留容量时", change: "-1.4%", sample: 31, scope: "含税 · 含基础网络", updatedAt: "18:35" },
  { spec: "20 kW 独占机柜", region: "华南", price: "¥ 13,800", unit: "机柜月", change: "+1.2%", sample: 18, scope: "含税 · 电费另计 · 含网络", updatedAt: "18:32" },
];

const categories = [
  { code: "01", title: "GPU 算力", note: "裸金属、云主机与集群", count: "8 类规格", href: "/resources?category=gpu" },
  { code: "02", title: "Token / 模型", note: "用量、实例与预留容量", count: "6 类服务", href: "/resources?category=token_model" },
  { code: "03", title: "整机柜 / 容量", note: "服务器、功率与算力池", count: "5 个区域", href: "/resources?category=rack_capacity" },
  { code: "04", title: "云厂商资源", note: "公有云与渠道可用额度", count: "8 家供方", href: "/resources?category=cloud_vendor" },
];

const serviceEntries = serviceAliases.map((alias) => {
  const params = new URLSearchParams({
    category: alias.category,
    deal: alias.dealMode,
    unit: alias.pricingUnit,
  });
  return [alias.label, `/resources?${params.toString()}`] as const;
});

const process = [
  { step: "01", title: "查看标准行情", text: "按同规格、同地区、同交付口径比较 P25、P50 与 P75。" },
  { step: "02", title: "筛选匹配资源", text: "从资源类别、期限、交付形态与计价单位缩小范围。" },
  { step: "03", title: "发布租赁或置换", text: "KAI 汇总供方响应，形成可横向比较的标准化方案。" },
];

export default function Home() {
  const min = Math.min(...trend);
  const max = Math.max(...trend);

  return (
    <>
      <section className="bg-[#0b1416] text-[#cad7d8]">
        <div className="shell py-5">
          <div className="demo-notice !border-[#31474a] !border-t-[#69d1cb] !bg-[#17282b] !text-[#cad7d8]">
            <p><strong className="!text-[#f2f7f7]">演示数据环境</strong>　所有资源、供应商与报价均为虚构样例，仅用于验证产品体验。</p>
            <Link className="text-[#69d1cb] underline" href="/methodology">查看数据口径</Link>
          </div>
        </div>

        <div className="shell grid gap-12 pb-16 pt-12 lg:grid-cols-12 lg:pb-24 lg:pt-20">
          <div className="lg:col-span-7">
            <p className="kicker !text-[#69d1cb]">China Token Academy / Compute Market</p>
            <h1 className="max-w-4xl text-[clamp(2.5rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.05em] !text-[#f2f7f7]">
              让异构算力，拥有可比较的市场语言。
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-[#cad7d8]">
              聚合 GPU、Token、模型容量、整机柜与云厂商资源，以标准化行情驱动租赁与置换。
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link className="button button-primary" href="/request">发布算力需求</Link>
              <Link className="button border-[#557376] bg-transparent !text-[#f2f7f7] hover:border-[#69d1cb]" href="/resources">查找可用资源</Link>
            </div>
            <dl className="mt-14 grid max-w-2xl grid-cols-3 border-y border-[#31474a] py-5">
              <div>
                <dt className="text-xs text-[#9aaeb0]">演示资源</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-[#f2f7f7]">24</dd>
              </div>
              <div className="border-x border-[#31474a] px-5">
                <dt className="text-xs text-[#9aaeb0]">虚构供方</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-[#f2f7f7]">8</dd>
              </div>
              <div className="pl-5">
                <dt className="text-xs text-[#9aaeb0]">覆盖区域</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-[#f2f7f7]">6</dd>
              </div>
            </dl>
          </div>

          <div className="border-t-2 border-[#69d1cb] bg-[#111c1f] p-5 sm:p-7 lg:col-span-5">
            <div className="flex items-start justify-between gap-4 border-b border-[#31474a] pb-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#9aaeb0]">KAI Compute Index</p>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="text-4xl font-semibold tabular-nums text-[#f2f7f7]">107.6</span>
                  <span className="text-sm font-semibold text-[#69d1cb]">30 日 +9.3%</span>
                </div>
              </div>
              <span className="border border-[#557376] px-2 py-1 text-xs text-[#cad7d8]">更新 18:40</span>
            </div>
            <figure className="mt-6" aria-labelledby="home-trend-title">
              <figcaption id="home-trend-title" className="flex justify-between text-xs text-[#9aaeb0]">
                <span>近 30 日综合指数</span><span>基期 = 100</span>
              </figcaption>
              <div className="mt-5 flex h-36 items-end gap-[3px] border-b border-[#557376]" role="img" aria-label="KAI 综合指数从 98.4 上升至 107.6，近 30 日总体上行">
                {trend.map((value, index) => {
                  const height = 22 + ((value - min) / (max - min)) * 76;
                  return (
                    <span
                      key={`${value}-${index}`}
                      className="min-w-0 flex-1 bg-[#69d1cb] opacity-80"
                      style={{ height: `${height}%` }}
                      title={`第 ${index + 1} 日：${value}`}
                    />
                  );
                })}
              </div>
              <p className="mt-4 text-sm leading-6 text-[#cad7d8]">演示结论：GPU 卡时价格回落，预留推理容量需求连续三周上升。</p>
            </figure>
          </div>
        </div>
      </section>

      <section className="shell py-16 lg:py-24" aria-labelledby="quote-heading">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="kicker">Market Snapshot / 2026-08-01</p>
            <h2 id="quote-heading" className="section-heading">今日市场快照</h2>
            <p className="section-lead">先统一价格口径，再讨论资源是否真正便宜。</p>
          </div>
          <Link className="button button-secondary" href="/market">查看完整行情</Link>
        </div>
        <div className="data-table-wrap mt-10">
          <table className="data-table">
            <thead>
              <tr><th>代表规格</th><th>地区</th><th className="num">P50 参考价</th><th>单位</th><th className="num">7 日变化</th><th>样本 / 价格口径</th><th>更新时间</th></tr>
            </thead>
            <tbody>
              {quoteRows.map((row) => (
                <tr key={row.spec}>
                  <td className="font-semibold text-[var(--ink)]">{row.spec}</td>
                  <td>{row.region}</td>
                  <td className="num font-semibold text-[var(--ink)]">{row.price}</td>
                  <td>{row.unit}</td>
                  <td className="num text-[var(--accent)]">{row.change}</td>
                  <td><span className="font-semibold text-[var(--ink)]">{row.sample} 条</span><span className="mt-1 block text-xs text-[var(--muted)]">{row.scope}</span></td>
                  <td className="whitespace-nowrap tabular-nums">2026-08-01 {row.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-[var(--muted)]">演示参考价 · 非实时成交价 · 含税口径以资源详情为准 · 更新时间 2026-08-01 18:40 CST</p>
      </section>

      <section className="border-y border-[var(--border)] bg-[var(--surface)] py-16 lg:py-24" aria-labelledby="categories-heading">
        <div className="shell">
          <p className="kicker">Four Resource Families</p>
          <h2 id="categories-heading" className="section-heading">四类资源，一套市场坐标</h2>
          <div className="mt-10 grid border-t-2 border-[var(--accent)] md:grid-cols-2 xl:grid-cols-4">
            {categories.map((item) => (
              <Link
                key={item.code}
                href={item.href}
                className="group border-b border-[var(--border)] p-6 no-underline md:border-r"
              >
                <span className="text-xs font-bold text-[var(--accent)]">{item.code}</span>
                <h3 className="mt-12 text-xl">{item.title}</h3>
                <p className="mt-2 text-sm text-[var(--text)]">{item.note}</p>
                <p className="mt-8 flex justify-between border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
                  <span>{item.count}</span><span className="text-[var(--accent)] group-hover:underline">进入市场</span>
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="shell grid gap-12 py-16 lg:grid-cols-12 lg:py-24" aria-labelledby="services-heading">
        <div className="lg:col-span-4">
          <p className="kicker">Business Entry Points</p>
          <h2 id="services-heading" className="section-heading">十种业务入口，不再是十座信息孤岛</h2>
          <p className="section-lead !text-base">每个名称都映射为资源类别、交易方式和计价单位，用户看到熟悉的业务语言，平台保留统一的数据结构。</p>
        </div>
        <div className="grid border-t-2 border-[var(--accent)] sm:grid-cols-2 lg:col-span-8">
          {serviceEntries.map(([label, href], index) => (
            <Link key={label} href={href} className="flex min-h-20 items-center justify-between border-b border-[var(--border)] px-4 py-3 text-[var(--ink)] no-underline sm:odd:border-r">
              <span className="font-semibold">{label}</span>
              <span className="text-xs tabular-nums text-[var(--muted)]">{String(index + 1).padStart(2, "0")}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-[var(--brand-soft)] py-16 lg:py-24" aria-labelledby="process-heading">
        <div className="shell">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <p className="kicker">From Signal to Action</p>
              <h2 id="process-heading" className="section-heading">从行情信号到业务动作</h2>
            </div>
            <ol className="grid border-t-2 border-[var(--accent)] md:grid-cols-3 lg:col-span-8">
              {process.map((item) => (
                <li key={item.step} className="border-b border-[var(--border-strong)] p-6 md:border-r">
                  <span className="text-xs font-bold text-[var(--accent)]">{item.step}</span>
                  <h3 className="mt-10 text-xl">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6">{item.text}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-between gap-6 border-t border-[var(--border-strong)] pt-8">
            <p className="max-w-2xl text-lg font-semibold text-[var(--ink)]">下一项算力采购，不必从零开始问价。</p>
            <div className="flex flex-wrap gap-3">
              <Link className="button button-primary" href="/request">发布算力需求</Link>
              <Link className="button button-secondary" href="/partners">成为资源供应方</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
