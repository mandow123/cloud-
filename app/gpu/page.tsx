import type { Metadata } from "next";
import { Suspense } from "react";
import { HostingGpuMarketplace } from "@/components/hosting-gpu-marketplace";
import { ResourceExplorer } from "@/components/resource-explorer";
import { resourceListings, suppliers } from "@/lib/data";
import { isHostingV2Enabled } from "@/lib/server/hosting-v2-feature";
import { requireHostingV2TransactionCapability } from "@/lib/server/hosting-v2-transaction-gate";

export const metadata: Metadata = {
  title: "GPU 算力目录",
  description: "查看供应商 GPU 报价，登录后提交询价与人工交付申请。",
};

const supplierIds = new Set(suppliers.map((supplier) => supplier.id));
const gpuListings = resourceListings
  .filter((listing) => listing.category === "gpu"
    && listing.source?.kind === "SUPPLIER_PROVIDED_QUOTE"
    && supplierIds.has(listing.supplierId))
  .sort((left, right) => Number(right.id.startsWith("gpu-honghuan-")) - Number(left.id.startsWith("gpu-honghuan-")));

function GpuDirectoryFallback() {
  return <div className="shell py-24 text-center" role="status">正在读取 GPU 供应商报价…</div>;
}

async function hostingMarketReady() {
  if (!isHostingV2Enabled()) return false;
  try {
    await requireHostingV2TransactionCapability();
    return true;
  } catch {
    return false;
  }
}

export default async function GpuMarketplacePage() {
  if (await hostingMarketReady()) return <HostingGpuMarketplace />;
  return (
    <Suspense fallback={<GpuDirectoryFallback />}>
      <ResourceExplorer
        heading="GPU 算力目录"
        lead="查看供应商 GPU 报价、规格与来源；登录后提交询价，由平台协调库存确认和人工交付。"
        listings={gpuListings}
      />
    </Suspense>
  );
}
