import type { Metadata } from "next";
import { RequestWorkbench, type RequestPrefill } from "@/components/request-workbench";
import { resourceListings, serviceAliases } from "@/lib/data";
import { categoryPricingUnits, marketplaceCategories } from "@/lib/marketplace";
import type { DealMode, PricingUnit, ResourceCategory } from "@/lib/types";

export const metadata: Metadata = {
  title: "发布算力需求",
  description: "发布 GPU、Token、模型、整机柜与云厂商资源的演示租赁、服务采购或双边置换需求。",
};

type RequestPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RequestPage({ searchParams }: RequestPageProps) {
  const params = await searchParams;
  const listingId = first(params.listing) ?? first(params.resource);
  const serviceSlug = first(params.service) ?? first(params.alias);
  const requestedMode = first(params.mode) ?? first(params.deal);
  const requestedCategory = first(params.category);
  const requestedUnit = first(params.unit);
  const requestedTitle = first(params.title);
  const requestedRegion = first(params.region);
  const listing = listingId ? resourceListings.find((item) => item.id === listingId) : undefined;
  const service = serviceSlug ? serviceAliases.find((item) => item.slug === serviceSlug) : undefined;
  const directCategory = marketplaceCategories.includes(requestedCategory as ResourceCategory)
    ? requestedCategory as ResourceCategory
    : undefined;
  const directUnit = directCategory && categoryPricingUnits[directCategory].includes(requestedUnit as PricingUnit)
    ? requestedUnit as PricingUnit
    : undefined;

  const mode: DealMode =
    requestedMode === "swap" || requestedMode === "service" || requestedMode === "rental"
      ? requestedMode
      : service?.dealMode ?? listing?.dealModes[0] ?? "rental";
  const prefill: RequestPrefill | undefined = listing
    ? {
        title: listing.title,
        category: listing.category,
        pricingUnit: listing.pricingUnit,
        region: listing.region,
      }
    : service
      ? {
          title: service.label,
          category: service.category,
          pricingUnit: service.pricingUnit,
        }
      : directCategory
        ? {
            title: requestedTitle,
            category: directCategory,
            pricingUnit: directUnit ?? categoryPricingUnits[directCategory][0],
            region: requestedRegion,
          }
        : undefined;

  return (
    <>
      <header className="border-b border-[var(--border)] bg-[var(--info-bg)]">
        <div className="shell py-12 sm:py-16">
          <p className="kicker">Demand workbench</p>
          <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <h1 className="m-0 max-w-4xl text-4xl leading-tight sm:text-5xl">把需求说清楚，再比较标准化方案</h1>
              <p className="section-lead">租赁或服务采购可直接描述目标资源；置换则分别填写“我可提供”和“我需要”。</p>
            </div>
            <div className="border-l-2 border-[var(--accent)] pl-5 text-sm text-[var(--text)]">
              <strong className="block text-[var(--ink)]">演示业务 · 服务端留存</strong>
              提交后会生成需求编号并写入演示数据库，供会员中心两侧继续流转；不会触发真实采购或联系供应商。
            </div>
          </div>
        </div>
      </header>

      <div className="shell py-12 sm:py-16">
        <RequestWorkbench initialMode={mode} initialPrefill={prefill} />
      </div>
    </>
  );
}
