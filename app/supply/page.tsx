import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "算力与资源上架中心",
  description: "面向个人、企业、IDC、云厂商及 KAI 自有资源的通用供给上架中心。",
};

const steps = [
  ["01", "登记资源", "填写供应身份、资源类型、规格、数量、计价口径与交付方式。"],
  ["02", "平台核验", "根据资源类型核对权属、规格、可用容量和交付能力。"],
  ["03", "上架审核", "冻结可展示的规格与供给范围；交易方式在后续阶段配置。"],
  ["04", "安全成交", "只有支付、库存、身份和交付安全门全部通过后才能成交。"],
];

export default function SupplyHomePage() {
  return (
    <div className="shell py-10 sm:py-14">
      <section aria-labelledby="supply-path-title">
        <p className="kicker">Primary supply entry</p>
        <h2 className="section-heading" id="supply-path-title">上架任意可供资源</h2>
        <p className="section-lead max-w-4xl">支持 GPU 卡、GPU/CPU 服务器、Mac 算力、Token 容量、模型实例、NAS、机柜容量和云厂商资源。H100 与 Mac mini 只是 KAI 自有资产的快捷预设。</p>

        <article className="mt-7 border-t-4 border-[var(--accent)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)] sm:p-8">
          <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <span className="font-mono text-sm font-bold text-[var(--accent)]">GENERAL OFFER / FIRST ENTRY</span>
              <h3 className="mb-0 mt-3 text-3xl">通用资源上架</h3>
              <p className="mt-4 max-w-3xl text-[var(--text)]">选择供应方身份与资源类型，填写实际产品名称、规格、数量和合法计价单位。GPU 型号不锁定 H100，也不会在接口失败时生成本地假记录。</p>
              <Link className="button button-primary mt-6" href="/supply/new">开始上架资源</Link>
            </div>
            <dl className="grid gap-px bg-[var(--border)] text-sm sm:grid-cols-2 lg:grid-cols-1">
              <div className="bg-[var(--info-bg)] p-4"><dt>供应身份</dt><dd className="m-0 font-semibold text-[var(--ink)]">个人 / 企业 / IDC / 云厂商</dd></div>
              <div className="bg-[var(--info-bg)] p-4"><dt>当前边界</dt><dd className="m-0 font-semibold text-[var(--ink)]">先登记供给，交易方式暂缓</dd></div>
            </dl>
          </div>
        </article>

        <div className="mt-5 grid gap-5 lg:grid-cols-2" aria-label="KAI 自有资产快捷预设">
          <article className="border-t-4 border-[var(--border-strong)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)] sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><span className="font-mono text-sm font-bold text-[var(--muted)]">KAI SELF PRESET / H100</span><h3 className="mb-0 mt-3 text-2xl">8×H100 SXM5 80GB</h3></div>
              <span className="bg-[var(--accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--ink)]">KAI 自有资产</span>
            </div>
            <p className="mt-5 text-sm text-[var(--text)]">固定 8 卡同节点、整机独占 SSH、¥1/卡时的限量试运行预设，仅用于已确认的 KAI 自有节点。</p>
            <Link className="button button-secondary mt-5" href="/supply/h100/new">使用 H100 快捷预设</Link>
          </article>

          <article className="border-t-4 border-[var(--border-strong)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)] sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><span className="font-mono text-sm font-bold text-[var(--muted)]">KAI SELF PRESET / MAC</span><h3 className="mb-0 mt-3 text-2xl">Mac mini 批量资产</h3></div>
              <span className="bg-[var(--info-bg)] px-3 py-2 text-sm font-semibold text-[var(--ink)]">KAI 自有资产</span>
            </div>
            <p className="mt-5 text-sm text-[var(--text)]">面向 KAI 自有 Mac mini 的批量入库、检测和分组预设；第一阶段不生成价格、挂牌或订单。</p>
            <Link className="button button-secondary mt-5" href="/supply/mac/import">使用 Mac 快捷预设</Link>
          </article>
        </div>
      </section>

      <section aria-labelledby="supply-process-title" className="mt-14 border-y border-[var(--border)] py-10">
        <p className="kicker">Controlled workflow</p>
        <h2 className="section-heading" id="supply-process-title">上架不是直接成交</h2>
        <ol className="mt-7 grid gap-px bg-[var(--border)] md:grid-cols-2 xl:grid-cols-4">
          {steps.map(([number, title, description]) => (
            <li className="list-none bg-[var(--surface)] p-5" key={number}>
              <span className="font-mono text-sm font-bold text-[var(--accent)]">{number}</span>
              <h3 className="mb-2 mt-5 text-xl">{title}</h3>
              <p className="m-0 text-sm leading-6 text-[var(--text)]">{description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10 flex flex-wrap items-center justify-between gap-5 bg-[var(--info-bg)] p-6 sm:p-8" aria-label="供应工作台入口">
        <div>
          <p className="kicker">Workspace</p>
          <h2 className="m-0 text-2xl">查看服务端上架记录</h2>
          <p className="mb-0 mt-2 text-sm text-[var(--text)]">通用上架记录和 KAI 自有资产池均以服务端回执为准。</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link className="button button-secondary" href="/supply/assets">资源资产</Link>
          <Link className="button button-primary" href="/supply/listings">上架计划</Link>
        </div>
      </section>
    </div>
  );
}
