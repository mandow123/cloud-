import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "数据与计价方法",
  description: "KAI Cloud 演示行情的计价单位、分位数、容量小时与标准化汇总方法。",
};

const units = [
  ["卡时", "单张 GPU 持续可用一小时", "GPU 租赁、GPU 置换"],
  ["服务器时", "单台完整服务器持续可用一小时", "整机算力与云主机"],
  ["百万 Token", "模型实际处理的一百万个 Token", "Token 小时服务的用量结算"],
  ["模型实例时", "一个独占模型实例持续运行一小时", "模型小时服务"],
  ["预留容量时", "约定吞吐、并发或 GPU 容量乘以预留小时", "模型容量与算力容量服务"],
  ["机柜月", "一个约定功率与网络条件的机柜使用一个自然月", "整机柜与容量租赁"],
  ["kW 月", "一千瓦可交付功率容量使用一个自然月", "数据中心功率容量"],
];

export default function MethodologyPage() {
  return (
    <>
      <header className="border-b border-[var(--border)] bg-[var(--info-bg)]">
        <div className="narrow-shell py-14 sm:py-20">
          <p className="kicker">Market methodology</p>
          <h1 className="m-0 text-4xl leading-tight sm:text-5xl">行情先统一口径，再讨论价格</h1>
          <p className="section-lead">
            KAI Cloud 将异构算力报价拆成可比较字段，并通过分位数展示市场区间。当前所有数据均为虚构演示。
          </p>
          <div className="demo-notice mt-8">
            <strong>演示数据声明</strong>
            <span>不代表实时库存、真实成交价或投资建议；不得用于采购、合同或财务决策。</span>
          </div>
        </div>
      </header>

      <article className="narrow-shell py-14 sm:py-20">
        <section aria-labelledby="unit-heading">
          <p className="kicker">01 / Units</p>
          <h2 className="section-heading" id="unit-heading">
            七种标准计价单位
          </h2>
          <p className="section-lead text-base">
            每条演示报价同时保留币种、含税状态、电费、网络、有效期、样本量和更新时间，避免只比较一个数字。
          </p>
          <div className="data-table-wrap mt-8">
            <table className="data-table">
              <caption className="sr-only">KAI Cloud 标准计价单位与适用场景</caption>
              <thead>
                <tr>
                  <th scope="col">单位</th>
                  <th scope="col">统一定义</th>
                  <th scope="col">主要场景</th>
                </tr>
              </thead>
              <tbody>
                {units.map(([unit, definition, scenario]) => (
                  <tr key={unit}>
                    <th className="whitespace-nowrap text-[var(--ink)]" scope="row">
                      {unit}
                    </th>
                    <td>{definition}</td>
                    <td>{scenario}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="capacity-heading" className="mt-20 border-t border-[var(--border)] pt-12">
          <p className="kicker">02 / Capacity hour</p>
          <h2 className="section-heading" id="capacity-heading">
            “容量小时”衡量的是被预留的能力
          </h2>
          <div className="mt-8 grid gap-px bg-[var(--border)] sm:grid-cols-3">
            <div className="bg-[var(--surface)] p-5">
              <p className="m-0 text-xs font-bold uppercase tracking-[0.1em] text-[var(--accent)]">Capacity</p>
              <h3 className="my-3 text-xl">约定容量</h3>
              <p className="m-0 text-sm">GPU 数量、吞吐、并发或模型实例规模。</p>
            </div>
            <div className="bg-[var(--surface)] p-5">
              <p className="m-0 text-xs font-bold uppercase tracking-[0.1em] text-[var(--accent)]">Time</p>
              <h3 className="my-3 text-xl">预留时长</h3>
              <p className="m-0 text-sm">从可用开始到释放容量的约定小时数。</p>
            </div>
            <div className="bg-[var(--surface)] p-5">
              <p className="m-0 text-xs font-bold uppercase tracking-[0.1em] text-[var(--accent)]">Result</p>
              <h3 className="my-3 text-xl">容量 × 小时</h3>
              <p className="m-0 text-sm">即使实际用量较低，预留能力仍被占用，因此不同于实际 Token 用量。</p>
            </div>
          </div>
          <div className="mt-5 border-l-4 border-[var(--accent)] bg-[var(--accent-soft)] p-5 text-sm">
            <strong className="text-[var(--ink)]">示例：</strong>预留 8 张 GPU、持续 10 小时，记录为 80 GPU 容量时；如果是模型吞吐，则必须同时标注吞吐单位，不能直接与卡时互换。
          </div>
        </section>

        <section aria-labelledby="percentile-heading" className="mt-20 border-t border-[var(--border)] pt-12">
          <p className="kicker">03 / Percentiles</p>
          <h2 className="section-heading" id="percentile-heading">
            P25、P50、P75 如何阅读
          </h2>
          <dl className="mt-8 grid gap-6 md:grid-cols-3">
            {[
              ["P25", "偏低报价", "样本中约 25% 的报价不高于该值，通常伴随更严格的起订量或交付条件。"],
              ["P50", "市场中位", "一半样本高于该值、一半低于该值，作为 KAI 默认参考中心。"],
              ["P75", "偏高报价", "样本中约 75% 的报价不高于该值，可能包含更高 SLA 或更灵活交付。"],
            ].map(([term, label, description]) => (
              <div className="border-t-2 border-[var(--accent)] pt-5" key={term}>
                <dt className="font-mono text-3xl font-bold text-[var(--ink)]">{term}</dt>
                <dd className="mt-2 font-semibold text-[var(--ink)]">{label}</dd>
                <dd className="mt-2 text-sm text-[var(--text)]">{description}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-sm text-[var(--muted)]">
            分位数描述报价分布，不代表可按该价格成交。样本量较小、区域或交付条件不同，都会降低可比性。
          </p>
        </section>

        <section aria-labelledby="aggregation-heading" className="mt-20 border-t border-[var(--border)] pt-12">
          <p className="kicker">04 / Aggregation</p>
          <h2 className="section-heading" id="aggregation-heading">
            KAI 标准化与汇总流程
          </h2>
          <ol className="mt-8 grid gap-4">
            {[
              ["接收", "记录资源类别、单位、区域、容量、有效期与交付条件。"],
              ["校验", "剔除单位不完整、条件矛盾或超过有效期的演示报价。"],
              ["标准化", "统一为人民币参考口径，并单独保留税、电、网络等费用状态。"],
              ["分组", "仅在资源、区域、交付形态和计价单位可比时进入同一组。"],
              ["汇总", "计算 P25/P50/P75、样本量和更新时间；不公开供应商原始报价。"],
            ].map(([title, description], index) => (
              <li className="grid grid-cols-[48px_1fr] border-b border-[var(--border)] pb-4" key={title}>
                <span className="font-mono text-sm font-bold text-[var(--accent)]">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="m-0 text-lg">{title}</h3>
                  <p className="mb-0 mt-1 text-sm">{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="limits-heading" className="mt-20 border border-[var(--border-strong)] bg-[var(--info-bg)] p-6 sm:p-8">
          <p className="kicker">05 / Limits</p>
          <h2 className="m-0 text-2xl" id="limits-heading">
            当前版本的明确限制
          </h2>
          <ul className="mt-5 grid gap-2 pl-5 text-sm">
            <li>供应商、资源、库存、样本量与 90 天行情全部为虚构演示。</li>
            <li>指数和报价区间不连接交易所、云厂商 API 或实时市场。</li>
            <li>报价不构成要约；网站不完成支付、合同、交付或验收。</li>
            <li>需求与会员操作只保存在当前浏览器，不应输入真实个人或商业资料。</li>
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link className="button button-primary" href="/market">
              查看演示行情
            </Link>
            <Link className="button button-secondary" href="/request">
              模拟发布需求
            </Link>
          </div>
        </section>
      </article>
    </>
  );
}
