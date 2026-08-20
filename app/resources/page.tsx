import type { Metadata } from "next";
import { Suspense } from "react";
import { ResourceExplorer } from "@/components/resource-explorer";
import { classifyBuyCatalogListing } from "@/lib/buy-catalog";
import { resourceListings, suppliers } from "@/lib/data";
import { isBuyCatalogV2Enabled } from "@/lib/server/buy-catalog-feature";
import { manualDeliveryIntakeEnabled } from "@/lib/server/manual-delivery-intake";

export const metadata: Metadata = {
  title: "算力资源市场",
  description: "筛选并比较 GPU、Token、模型、整机柜容量与云厂商资源。",
};

function ResourceExplorerFallback() {
  return (
    <div className="shell py-24" role="status">
      <div className="border-y border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
        <p className="m-0 text-sm font-semibold text-[var(--ink)]">正在读取资源筛选条件…</p>
      </div>
    </div>
  );
}

export default function ResourcesPage() {
  const classifications = Object.fromEntries(resourceListings.map((listing) => [listing.id, classifyBuyCatalogListing(listing, suppliers)]));
  return (
    <Suspense fallback={<ResourceExplorerFallback />}>
      <ResourceExplorer classifications={classifications} inquiryEnabled={isBuyCatalogV2Enabled() && manualDeliveryIntakeEnabled()} listings={resourceListings} />
    </Suspense>
  );
}
