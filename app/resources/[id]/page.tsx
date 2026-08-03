import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResourceDetailActions } from "@/components/resource-detail-actions";
import { getResourceById, resourceListings } from "@/lib/data";
import { formatPrice } from "@/lib/market";
import type { DealMode, ResourceCategory } from "@/lib/types";

const CATEGORY_LABELS: Record<ResourceCategory, string> = {
  gpu: "GPU 算力",
  token_model: "Token / 模型",
  rack_capacity: "整机柜 / 容量",
  cloud_vendor: "云厂商资源",
};

const DEAL_LABELS: Record<DealMode, string> = {
  rental: "租赁",
  service: "服务采购",
  swap: "资源置换",
};

type ResourceDetailPageProps = {
  params: Promise<{ id: string }>;
};

export function generateStaticParams() {
  return resourceListings.map((resource) => ({ id: resource.id }));
}

export async function generateMetadata({ params }: ResourceDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const resource = getResourceById(id);
  if (!resource) return { title: "资源未找到" };
  return {
    title: `${resource.title} · 资源详情`,
    description: `${resource.summary} 市场参考报价，具体以询价确认为准。`,
  };
}

function yesNo(value: boolean, yes: string, no: string) {
  return value ? yes : no;
}

export default async function ResourceDetailPage({ params }: ResourceDetailPageProps) {
  const { id } = await params;
  const resource = getResourceById(id);
  if (!resource) notFound();

  const requestParams = new URLSearchParams({
    resource: resource.id,
    category: resource.category,
    deal: resource.dealModes[0],
    unit: resource.pricingUnit,
  });
  const requestHref = `/request?${requestParams.toString()}`;

  return (
    <div>
      <div className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="shell py-4">
          <nav className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]" aria-label="面包屑导航">
            <Link className="underline decoration-[var(--border-strong)] underline-offset-4 hover:text-[var(--accent)]" href="/resources">资源市场</Link>
            <span aria-hidden="true">/</span>
            <span>{CATEGORY_LABELS[resource.category]}</span>
            <span aria-hidden="true">/</span>
            <span className="text-[var(--ink)]" aria-current="page">{resource.title}</span>
          </nav>
        </div>
      </div>

      <section className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="shell grid gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-end lg:py-16">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="border border-[var(--border-strong)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]">{CATEGORY_LABELS[resource.category]}</span>
              {resource.dealModes.map((mode) => (
                <span key={mode} className="border border-[var(--border)] bg-[var(--info-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--text)]">{DEAL_LABELS[mode]}</span>
              ))}
            </div>
            <h1 className="mt-5 mb-0 max-w-4xl text-4xl leading-[1.08] text-[var(--ink)] sm:text-5xl">{resource.title}</h1>
            <p className="mt-5 mb-0 max-w-3xl text-lg leading-8 text-[var(--text)]">{resource.summary}</p>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted)]">
              <span><strong className="text-[var(--ink)]">{resource.supplierName}</strong> · 平台初始化供应方档案</span>
              <span>{resource.region}</span>
              <span>资源编号 {resource.id}</span>
            </div>
          </div>

          <div className="border-t-2 border-[var(--accent)] bg-[var(--info-bg)] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="m-0 text-xs font-semibold tracking-wide text-[var(--muted)]">市场参考报价</p>
                <p className="mt-2 mb-0 text-3xl font-semibold tabular-nums text-[var(--ink)]">
                  {formatPrice(resource.quote.median, resource.pricingUnit)}
                </p>
              </div>
              <span className="border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-xs font-semibold text-[var(--warning)]">询价后确认</span>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-5 border-t border-[var(--border)] pt-5">
              <div>
                <dt className="text-xs text-[var(--muted)]">参考区间</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums text-[var(--ink)]">
                  {formatPrice(resource.quote.rangeMin, resource.pricingUnit)} – {formatPrice(resource.quote.rangeMax, resource.pricingUnit)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">样本量</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums text-[var(--ink)]">{resource.quote.sampleCount} 条</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">更新于</dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">{resource.quote.updatedAt}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">有效期至</dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">{resource.quote.validUntil}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <div className="shell py-10 sm:py-12">
        <aside className="market-notice mb-10" aria-label="市场报价说明">
          <p className="m-0">
            <strong>重要说明：</strong>{resource.quote.disclaimer} 资源档案、容量与样本当前为平台初始化数据，供应方接入后核验。
          </p>
          <p className="m-0 whitespace-nowrap font-semibold text-[var(--warning)]">市场参考报价 · 询价后确认</p>
        </aside>

        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-12">
            <section aria-labelledby="resource-overview-title">
              <div className="mb-5 border-b border-[var(--border-strong)] pb-3">
                <p className="kicker">Resource profile</p>
                <h2 id="resource-overview-title" className="m-0 text-2xl text-[var(--ink)]">资源概览</h2>
              </div>
              <dl className="grid border-t-2 border-[var(--accent)] sm:grid-cols-2">
                {[
                  ["容量样本", resource.capacity],
                  ["服务等级 SLA", resource.sla],
                  ["交付形态", resource.deliveryForm],
                  ["预计交付周期", resource.deliveryLeadTime],
                ].map(([label, value], index) => (
                  <div key={label} className={`border-b border-[var(--border)] bg-[var(--surface)] p-5 ${index % 2 === 0 ? "sm:border-r" : ""}`}>
                    <dt className="text-xs font-semibold text-[var(--muted)]">{label}</dt>
                    <dd className="mt-2 text-lg font-semibold text-[var(--ink)]">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section aria-labelledby="resource-specs-title">
              <div className="mb-5 border-b border-[var(--border-strong)] pb-3">
                <p className="kicker">Technical specification</p>
                <h2 id="resource-specs-title" className="m-0 text-2xl text-[var(--ink)]">规格参数</h2>
              </div>
              <div className="overflow-hidden border border-[var(--border)]">
                <table className="data-table">
                  <tbody>
                    {Object.entries(resource.specs).map(([label, value]) => (
                      <tr key={label}>
                        <th className="w-1/3 min-w-36 text-[var(--muted)]" scope="row">{label}</th>
                        <td className="font-semibold text-[var(--ink)]">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-5 flex flex-wrap gap-2" aria-label="资源标签">
                {resource.tags.map((tag) => (
                  <span key={tag} className="border border-[var(--border)] bg-[var(--info-bg)] px-2.5 py-1 text-xs font-medium text-[var(--text)]">{tag}</span>
                ))}
              </div>
            </section>

            <section aria-labelledby="pricing-scope-title">
              <div className="mb-5 border-b border-[var(--border-strong)] pb-3">
                <p className="kicker">Pricing scope</p>
                <h2 id="pricing-scope-title" className="m-0 text-2xl text-[var(--ink)]">计价口径</h2>
              </div>
              <div className="border-t-2 border-[var(--accent)] bg-[var(--surface)]">
                <dl className="grid sm:grid-cols-2">
                  <div className="border-b border-[var(--border)] p-5 sm:border-r"><dt className="text-xs text-[var(--muted)]">币种与单位</dt><dd className="mt-2 font-semibold text-[var(--ink)]">人民币（CNY）/ {resource.pricingUnit}</dd></div>
                  <div className="border-b border-[var(--border)] p-5"><dt className="text-xs text-[var(--muted)]">税费</dt><dd className="mt-2 font-semibold text-[var(--ink)]">{yesNo(resource.quote.taxIncluded, "报价已含税", "报价未含税")}</dd></div>
                  <div className="border-b border-[var(--border)] p-5 sm:border-r"><dt className="text-xs text-[var(--muted)]">电力</dt><dd className="mt-2 font-semibold text-[var(--ink)]">{yesNo(resource.quote.energyIncluded, "已含基础电力", "不含电力费用")}</dd></div>
                  <div className="border-b border-[var(--border)] p-5"><dt className="text-xs text-[var(--muted)]">网络</dt><dd className="mt-2 font-semibold text-[var(--ink)]">{yesNo(resource.quote.networkIncluded, "已含基础网络", "不含网络费用")}</dd></div>
                </dl>
                <div className="border-b border-[var(--border)] bg-[var(--info-bg)] p-5">
                  <p className="m-0 text-xs font-semibold text-[var(--muted)]">补充口径</p>
                  <p className="mt-2 mb-0 text-sm leading-6 text-[var(--text)]">{resource.quote.scopeNote}</p>
                </div>
              </div>
              <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
                最终价格会受期限、资源数量、并发、网络、电力、税费与交付条件影响。页面展示市场参考报价，具体以询价确认为准。
              </p>
            </section>

            <section aria-labelledby="supplier-title">
              <div className="mb-5 border-b border-[var(--border-strong)] pb-3">
                <p className="kicker">Supplier profile</p>
                <h2 id="supplier-title" className="m-0 text-2xl text-[var(--ink)]">供应与撮合说明</h2>
              </div>
              <div className="grid gap-6 border border-[var(--border)] bg-[var(--surface)] p-5 sm:grid-cols-2 sm:p-6">
                <div>
                  <p className="m-0 text-xs font-semibold text-[var(--muted)]">供应方档案</p>
                  <p className="mt-2 mb-0 text-lg font-semibold text-[var(--ink)]">{resource.supplierName}</p>
                  <p className="mt-2 mb-0 text-sm leading-6 text-[var(--text)]">当前供应方档案为平台初始化样本，接入后核验；平台不对外披露其他供应方的原始报价。</p>
                </div>
                <div>
                  <p className="m-0 text-xs font-semibold text-[var(--muted)]">支持交易方式</p>
                  <ul className="mt-2 mb-0 list-none space-y-2 p-0 text-sm text-[var(--ink)]">
                    {resource.dealModes.map((mode) => <li key={mode}>— {DEAL_LABELS[mode]}</li>)}
                  </ul>
                </div>
              </div>
            </section>
          </div>

          <aside className="border border-[var(--border)] bg-[var(--surface)] lg:sticky lg:top-28" aria-label="资源操作">
            <div className="border-b border-[var(--border)] p-5">
              <p className="m-0 text-xs font-semibold tracking-wide text-[var(--muted)]">NEXT STEP</p>
              <h2 className="mt-2 mb-0 text-xl text-[var(--ink)]">让 KAI 标准化此方案</h2>
              <p className="mt-2 mb-0 text-sm leading-6 text-[var(--text)]">带入资源类型、交易方式和计价单位，最少三步完成需求提交。</p>
            </div>
            <div className="p-5">
              <ResourceDetailActions resourceId={resource.id} resourceTitle={resource.title} requestHref={requestHref} />
            </div>
            <dl className="grid grid-cols-2 border-t border-[var(--border)] bg-[var(--info-bg)] text-xs">
              <div className="border-r border-[var(--border)] p-4"><dt className="text-[var(--muted)]">报价样本</dt><dd className="mt-1 font-semibold text-[var(--ink)]">{resource.quote.sampleCount} 条</dd></div>
              <div className="p-4"><dt className="text-[var(--muted)]">数据状态</dt><dd className="mt-1 font-semibold text-[var(--accent)]">平台初始化样本</dd></div>
            </dl>
          </aside>
        </div>

        <div className="mt-14 border-t border-[var(--border)] pt-5">
          <Link className="text-sm font-semibold text-[var(--accent)] underline underline-offset-4" href="/resources">← 返回资源市场继续比较</Link>
        </div>
      </div>
    </div>
  );
}
