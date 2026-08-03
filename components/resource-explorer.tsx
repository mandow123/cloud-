"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { filterAndSortResources, formatPrice, parseResourceQuery } from "@/lib/market";
import type { DealMode, ResourceCategory, ResourceListing } from "@/lib/types";

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

function unique(values: string[]) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function pricingScope(resource: ResourceListing) {
  const { quote } = resource;
  return [
    quote.taxIncluded ? "含税" : "未含税",
    quote.energyIncluded ? "含电力" : "未含电力",
    quote.networkIncluded ? "含网络" : "未含网络",
  ].join(" · ");
}

function publicCatalogText(value: string) {
  return value
    .replaceAll("（\u6f14\u793a）", "")
    .replaceAll("\u6f14\u793a可置换", "初始化样本可置换")
    .replaceAll("\u6f14\u793a可用", "初始化样本容量")
    .replaceAll("\u6f14\u793a日容量", "初始化样本日容量")
    .replaceAll("\u6f14\u793a SLA", "参考 SLA")
    .replaceAll("\u6f14\u793a服务", "服务")
    .replaceAll("\u6f14\u793a资源", "资源")
    .replaceAll("\u6f14\u793a值", "参考值")
    .replaceAll("\u6f14\u793a", "参考");
}

function FilterSelect({
  id,
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-xs font-semibold text-[var(--muted)]" htmlFor={id}>
      {label}
      <select
        id={id}
        className="min-h-11 w-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export function ResourceExplorer({ listings }: { listings: readonly ResourceListing[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareMessage, setCompareMessage] = useState("");

  const queryObject = useMemo(
    () => Object.fromEntries(searchParams.entries()),
    [searchParams],
  );
  const parsedFilters = useMemo(() => parseResourceQuery(queryObject), [queryObject]);
  const results = useMemo(
    () => filterAndSortResources(listings, parsedFilters),
    [listings, parsedFilters],
  );

  const regions = useMemo(() => unique(listings.map((item) => item.region)), [listings]);
  const deliveries = useMemo(() => unique(listings.map((item) => item.deliveryForm)), [listings]);
  const units = useMemo(() => unique(listings.map((item) => item.pricingUnit)), [listings]);
  const compared = compareIds
    .map((id) => listings.find((item) => item.id === id))
    .filter((item): item is ResourceListing => Boolean(item));

  function currentValue(key: string) {
    return searchParams.get(key) ?? "";
  }

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function clearFilters() {
    router.replace(pathname, { scroll: false });
  }

  function toggleCompare(id: string) {
    setCompareIds((current) => {
      if (current.includes(id)) {
        setCompareMessage("");
        return current.filter((item) => item !== id);
      }
      if (current.length >= 3) {
        setCompareMessage("一次最多比较 3 项资源，请先移除一项。 ");
        return current;
      }
      setCompareMessage("");
      return [...current, id];
    });
  }

  const activeFilterCount = ["category", "deal", "region", "delivery", "unit", "q"]
    .filter((key) => currentValue(key)).length;

  return (
    <div>
      <section className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="shell py-14 sm:py-16">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
            <div>
              <p className="kicker">Verified resource taxonomy</p>
              <h1 className="m-0 max-w-4xl text-4xl leading-[1.08] text-[var(--ink)] sm:text-5xl">算力资源市场</h1>
              <p className="section-lead">
                按资源类型、交易方式、区域、交付形态和计价单位筛选，并在同一口径下比较候选方案。
              </p>
            </div>
            <div className="border-t-2 border-[var(--accent)] bg-[var(--info-bg)] px-5 py-4">
              <div className="flex items-baseline justify-between gap-6">
                <span className="text-xs font-semibold text-[var(--muted)]">目录资源池</span>
                <strong className="text-3xl tabular-nums text-[var(--ink)]">{listings.length}</strong>
              </div>
              <p className="mt-2 mb-0 text-xs leading-5 text-[var(--muted)]">平台初始化样本资源，供应商接入后核验容量与报价。</p>
            </div>
          </div>
        </div>
      </section>

      <div className="shell py-10 sm:py-12">
        <aside className="market-notice mb-8" aria-label="报价声明">
          <p className="m-0"><strong>市场参考报价：</strong>所有报价均标明计价单位、税费、电费、网络与更新时间。</p>
          <p className="m-0 whitespace-nowrap font-semibold text-[var(--warning)]">具体以询价确认为准</p>
        </aside>

        <div className="grid items-start gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="border border-[var(--border)] bg-[var(--info-bg)] lg:sticky lg:top-28" aria-label="资源筛选">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-4">
              <h2 className="m-0 text-base text-[var(--ink)]">筛选资源</h2>
              {activeFilterCount > 0 && (
                <button
                  className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center border-0 bg-transparent px-2 text-xs font-semibold text-[var(--accent)] underline underline-offset-4"
                  type="button"
                  onClick={clearFilters}
                >
                  清除 {activeFilterCount} 项
                </button>
              )}
            </div>
            <div className="grid gap-5 p-4 sm:grid-cols-2 lg:grid-cols-1">
              <label className="grid gap-2 text-xs font-semibold text-[var(--muted)] sm:col-span-2 lg:col-span-1" htmlFor="resource-search">
                关键词
                <input
                  id="resource-search"
                  className="min-h-11 w-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)] placeholder:text-[var(--muted)]"
                  type="search"
                  value={currentValue("q")}
                  placeholder="型号、能力或供应商"
                  onChange={(event) => updateFilter("q", event.target.value)}
                />
              </label>
              <FilterSelect
                id="filter-category"
                label="资源分类"
                allLabel="全部分类"
                value={currentValue("category")}
                onChange={(value) => updateFilter("category", value)}
                options={(Object.entries(CATEGORY_LABELS) as Array<[ResourceCategory, string]>).map(([value, label]) => ({ value, label }))}
              />
              <FilterSelect
                id="filter-deal"
                label="交易方式"
                allLabel="全部方式"
                value={currentValue("deal")}
                onChange={(value) => updateFilter("deal", value)}
                options={(Object.entries(DEAL_LABELS) as Array<[DealMode, string]>).map(([value, label]) => ({ value, label }))}
              />
              <FilterSelect
                id="filter-region"
                label="资源区域"
                allLabel="全国区域"
                value={currentValue("region")}
                onChange={(value) => updateFilter("region", value)}
                options={regions.map((value) => ({ value, label: value }))}
              />
              <FilterSelect
                id="filter-delivery"
                label="交付形态"
                allLabel="全部形态"
                value={currentValue("delivery")}
                onChange={(value) => updateFilter("delivery", value)}
                options={deliveries.map((value) => ({ value, label: value }))}
              />
              <FilterSelect
                id="filter-unit"
                label="计价单位"
                allLabel="全部单位"
                value={currentValue("unit")}
                onChange={(value) => updateFilter("unit", value)}
                options={units.map((value) => ({ value, label: value }))}
              />
            </div>
          </aside>

          <div className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border-strong)] pb-4">
              <div>
                <p className="m-0 text-xs font-semibold tracking-wide text-[var(--muted)]">MATCHED INVENTORY</p>
                <p className="mt-1 mb-0 text-lg font-semibold text-[var(--ink)]">
                  找到 <span className="tabular-nums text-[var(--accent)]">{results.length}</span> 项资源
                </p>
              </div>
              <label className="flex items-center gap-3 text-xs font-semibold text-[var(--muted)]" htmlFor="resource-sort">
                排序
                <select
                  id="resource-sort"
                  className="min-h-11 border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
                  value={currentValue("sort") || "recommended"}
                  onChange={(event) => updateFilter("sort", event.target.value === "recommended" ? "" : event.target.value)}
                >
                  <option value="recommended">综合推荐</option>
                  <option value="price_asc">价格从低到高</option>
                  <option value="price_desc">价格从高到低</option>
                  <option value="updated_desc">最近更新</option>
                </select>
              </label>
            </div>

            {compareMessage && (
              <p className="my-4 border-l-2 border-[var(--warning)] bg-[var(--warning-bg)] px-4 py-3 text-sm text-[var(--warning)]" role="status">
                {compareMessage}
              </p>
            )}

            {compared.length > 0 && (
              <section className="my-6 border-t-2 border-[var(--accent)] bg-[var(--surface)]" aria-labelledby="compare-title">
                <div className="flex flex-wrap items-center justify-between gap-3 border-x border-b border-[var(--border)] px-4 py-3">
                  <div>
                    <h2 id="compare-title" className="m-0 text-base text-[var(--ink)]">方案对比</h2>
                    <p className="m-0 text-xs text-[var(--muted)]">已选择 {compared.length} / 3 项</p>
                  </div>
                  <button
                    className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center border-0 bg-transparent px-2 text-xs font-semibold text-[var(--accent)] underline underline-offset-4"
                    type="button"
                    onClick={() => { setCompareIds([]); setCompareMessage(""); }}
                  >
                    清空对比
                  </button>
                </div>
                <div className="overflow-x-auto border-x border-b border-[var(--border)]">
                  <table className="w-full min-w-[680px] border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="w-32 border-r border-[var(--border)] bg-[var(--info-bg)] p-3 text-left text-xs text-[var(--muted)]" scope="col">对比项</th>
                        {compared.map((resource) => (
                          <th key={resource.id} className="min-w-44 border-r border-[var(--border)] p-3 text-left align-top last:border-r-0" scope="col">
                            <Link className="inline-flex min-h-11 items-center font-semibold text-[var(--ink)] underline decoration-[var(--border-strong)] underline-offset-4 hover:text-[var(--accent)]" href={`/resources/${resource.id}`}>
                              {resource.title}
                            </Link>
                            <button
                              className="mt-1 inline-flex min-h-11 min-w-11 cursor-pointer items-center border-0 bg-transparent px-1 text-xs font-medium text-[var(--muted)] underline underline-offset-4"
                              type="button"
                              onClick={() => toggleCompare(resource.id)}
                            >移除</button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["市场参考报价", (item: ResourceListing) => formatPrice(item.quote.median, item.pricingUnit)],
                        ["区域 / 交付", (item: ResourceListing) => `${item.region} · ${item.deliveryForm}`],
                        ["容量样本", (item: ResourceListing) => publicCatalogText(item.capacity)],
                        ["目标服务等级", (item: ResourceListing) => publicCatalogText(item.sla)],
                        ["价格口径", (item: ResourceListing) => pricingScope(item)],
                        ["报价样本", (item: ResourceListing) => `${item.quote.sampleCount} 条`],
                        ["更新时间", (item: ResourceListing) => item.quote.updatedAt],
                      ].map(([label, render]) => (
                        <tr key={label as string} className="border-t border-[var(--border)]">
                          <th className="border-r border-[var(--border)] bg-[var(--info-bg)] p-3 text-left text-xs text-[var(--muted)]" scope="row">{label as string}</th>
                          {compared.map((resource) => (
                            <td key={resource.id} className="border-r border-[var(--border)] p-3 align-top text-[var(--text)] last:border-r-0">
                              {(render as (item: ResourceListing) => string)(resource)}
                              {label === "市场参考报价" && <span className="mt-1 block text-xs text-[var(--warning)]">具体以询价确认为准</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {results.length === 0 ? (
              <div className="mt-6 border-y border-[var(--border)] bg-[var(--surface)] px-6 py-20 text-center">
                <p className="m-0 text-xl font-semibold text-[var(--ink)]">没有匹配的目录资源</p>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">
                  当前筛选组合较窄。清除筛选后可浏览完整资源池，或发布需求由 KAI 进行人工撮合。
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <button className="button button-secondary cursor-pointer" type="button" onClick={clearFilters}>清除全部筛选</button>
                  <Link className="button button-primary" href="/request">发布算力需求</Link>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-6 hidden overflow-x-auto border border-[var(--border)] xl:block">
                  <table className="data-table min-w-[920px]">
                    <thead>
                      <tr>
                        <th scope="col">资源 / 供应商</th>
                        <th scope="col">分类 / 交易</th>
                        <th scope="col">区域 / 交付</th>
                        <th scope="col">容量样本 / 目标 SLA</th>
                        <th className="num" scope="col">市场参考报价</th>
                        <th scope="col">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((resource) => (
                        <tr key={resource.id}>
                          <td className="min-w-64">
                            <Link className="inline-flex min-h-11 items-center font-semibold text-[var(--ink)] underline decoration-[var(--border-strong)] underline-offset-4 hover:text-[var(--accent)]" href={`/resources/${resource.id}`}>
                              {resource.title}
                            </Link>
                            <span className="mt-1 block text-xs text-[var(--muted)]">{publicCatalogText(resource.supplierName)} · 供应商目录</span>
                          </td>
                          <td className="min-w-40">
                            <span className="font-semibold text-[var(--ink)]">{CATEGORY_LABELS[resource.category]}</span>
                            <span className="mt-1 block text-xs text-[var(--muted)]">{resource.dealModes.map((mode) => DEAL_LABELS[mode]).join(" / ")}</span>
                          </td>
                          <td className="min-w-40">{resource.region}<span className="mt-1 block text-xs text-[var(--muted)]">{resource.deliveryForm}</span></td>
                          <td className="min-w-44">{publicCatalogText(resource.capacity)}<span className="mt-1 block text-xs text-[var(--muted)]">SLA {publicCatalogText(resource.sla)}</span></td>
                          <td className="num min-w-44">
                            <strong className="block whitespace-nowrap text-xl text-[var(--ink)]">{formatPrice(resource.quote.median, resource.pricingUnit)}</strong>
                            <span className="mt-1 block text-xs text-[var(--warning)]">市场参考报价 · 具体以询价确认为准</span>
                            <span className="mt-1 block text-xs text-[var(--muted)]">{pricingScope(resource)}</span>
                            <span className="mt-1 block text-xs text-[var(--muted)]">样本 {resource.quote.sampleCount} 条 · 更新 {resource.quote.updatedAt}</span>
                          </td>
                          <td className="min-w-32">
                            <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--text)]">
                              <input
                                type="checkbox"
                                checked={compareIds.includes(resource.id)}
                                onChange={() => toggleCompare(resource.id)}
                              />
                              加入对比
                            </label>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 grid gap-4 xl:hidden">
                  {results.map((resource) => (
                    <article key={resource.id} className="border-t-2 border-[var(--border-strong)] bg-[var(--surface)] p-5 ring-1 ring-[var(--border)]">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="m-0 text-xs font-semibold text-[var(--accent)]">{CATEGORY_LABELS[resource.category]} · {resource.region}</p>
                          <h2 className="mt-2 mb-0 text-xl text-[var(--ink)]">
                            <Link className="inline-flex min-h-11 items-center hover:text-[var(--accent)]" href={`/resources/${resource.id}`}>{resource.title}</Link>
                          </h2>
                          <p className="mt-1 mb-0 text-xs text-[var(--muted)]">{publicCatalogText(resource.supplierName)} · 供应商目录</p>
                        </div>
                        <label className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--text)]">
                          <input type="checkbox" checked={compareIds.includes(resource.id)} onChange={() => toggleCompare(resource.id)} />
                          对比
                        </label>
                      </div>
                      <p className="mt-5 mb-0 text-sm leading-6 text-[var(--text)]">{publicCatalogText(resource.summary)}</p>
                      <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-[var(--border)] py-4 text-sm">
                        <div><dt className="text-xs text-[var(--muted)]">交付形态</dt><dd className="mt-1 font-semibold text-[var(--ink)]">{resource.deliveryForm}</dd></div>
                        <div><dt className="text-xs text-[var(--muted)]">交付周期</dt><dd className="mt-1 font-semibold text-[var(--ink)]">{publicCatalogText(resource.deliveryLeadTime)}</dd></div>
                        <div><dt className="text-xs text-[var(--muted)]">容量样本</dt><dd className="mt-1 font-semibold text-[var(--ink)]">{publicCatalogText(resource.capacity)}</dd></div>
                        <div><dt className="text-xs text-[var(--muted)]">目标服务等级</dt><dd className="mt-1 font-semibold text-[var(--ink)]">{publicCatalogText(resource.sla)}</dd></div>
                      </dl>
                      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
                        <div>
                          <p className="m-0 text-xs text-[var(--muted)]">市场参考报价</p>
                          <p className="mt-1 mb-0 text-2xl font-semibold tabular-nums text-[var(--ink)]">{formatPrice(resource.quote.median, resource.pricingUnit)}</p>
                          <p className="m-0 text-xs text-[var(--warning)]">具体以询价确认为准 · {pricingScope(resource)}</p>
                          <p className="mt-1 mb-0 text-xs text-[var(--muted)]">样本 {resource.quote.sampleCount} 条 · 更新 {resource.quote.updatedAt}</p>
                        </div>
                        <Link className="button button-secondary button-compact" href={`/resources/${resource.id}`}>查看详情 →</Link>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}

            {results.length > 0 && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
                <span>共 {results.length} 项 · 报价更新以各资源详情页为准</span>
                <span>平台初始化样本，供应商接入后核验更新</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
