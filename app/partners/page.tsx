import type { Metadata } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { PartnerForm } from "@/components/partner-form";
import { isHostingV2Enabled } from "@/lib/server/hosting-v2-feature";

export const metadata: Metadata = {
  title: "供应商合作",
  description: "了解 KAI Cloud 供应方入驻、报价标准化与资源撮合流程。",
};

const steps = [
  {
    number: "01",
    title: "资源校验",
    description: "确认资源类型、区域、可供容量、交付形态与基础服务边界。",
  },
  {
    number: "02",
    title: "口径标准化",
    description: "将含税、电费、网络、有效期等报价条件拆分为可比较字段。",
  },
  {
    number: "03",
    title: "需求匹配",
    description: "仅向匹配的需求方提供由 KAI 整理的标准化方案，原始报价不在供应商间公开。",
  },
  {
    number: "04",
    title: "人工确认",
    description: "正式成交由双方另行完成合同、交付与验收；平台保留人工复核与状态跟踪。",
  },
];

export default function PartnersPage() {
  if (isHostingV2Enabled()) permanentRedirect("/hosting/partners");

  return (
    <>
      <header className="border-b border-[var(--border)] bg-[var(--info-bg)]">
        <div className="shell py-14 sm:py-20">
          <p className="kicker">Partner network</p>
          <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <h1 className="m-0 max-w-4xl text-4xl leading-tight sm:text-5xl">把分散供给，整理成可比较、可交付的算力资源</h1>
              <p className="section-lead">
                面向 GPU、Token、模型实例、整机柜与云厂商资源的供应方。KAI Cloud 以统一计价口径连接供需双方。
              </p>
            </div>
            <div className="border-l-2 border-[var(--accent)] pl-5 text-sm text-[var(--text)]">
              <strong className="block text-[var(--ink)]">本机入驻预登记</strong>
              下方表单不联网、不创建账户，也不接收入驻申请。请勿提交企业全称、联系人或商业机密。
            </div>
          </div>
        </div>
      </header>

      <section aria-labelledby="partner-process" className="shell py-14 sm:py-20">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker">Onboarding</p>
            <h2 className="section-heading" id="partner-process">
              四步形成标准化供给
            </h2>
          </div>
          <Link className="text-sm font-semibold text-[var(--accent)] underline" href="/methodology">
            查看数据与计价方法
          </Link>
        </div>
        <ol className="grid border-y border-[var(--border)] md:grid-cols-2 xl:grid-cols-4">
          {steps.map((step) => (
            <li className="border-b border-[var(--border)] p-5 last:border-b-0 md:border-r md:[&:nth-child(2)]:border-r-0 xl:border-b-0 xl:[&:nth-child(2)]:border-r xl:last:border-r-0" key={step.number}>
              <span className="font-mono text-sm font-bold text-[var(--accent)]">{step.number}</span>
              <h3 className="mb-2 mt-6 text-xl">{step.title}</h3>
              <p className="m-0 text-sm text-[var(--text)]">{step.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-[var(--border)] bg-[var(--surface)]">
        <div className="shell grid gap-10 py-14 lg:grid-cols-[0.8fr_1.2fr] lg:py-20">
          <div>
            <p className="kicker">Supply standard</p>
            <h2 className="section-heading">入驻资源需要说明什么</h2>
            <p className="section-lead text-base">
              核心不是一张孤立价格表，而是价格背后的可用容量、服务边界与交付条件。
            </p>
          </div>
          <dl className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
            {[
              ["资源边界", "型号、规模、精度、网络和存储条件"],
              ["容量边界", "起订量、可用时段、并发或吞吐上限"],
              ["报价边界", "税费、电费、网络、币种与价格有效期"],
              ["交付边界", "开通周期、SLA、支持方式和验收口径"],
            ].map(([term, description]) => (
              <div className="bg-[var(--canvas)] p-5" key={term}>
                <dt className="font-semibold text-[var(--ink)]">{term}</dt>
                <dd className="mt-2 text-sm text-[var(--text)]">{description}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="narrow-shell py-14 sm:py-20">
        <PartnerForm />
      </div>
    </>
  );
}
