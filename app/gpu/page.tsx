import type { Metadata } from "next";
import { Suspense } from "react";
import { HostingGpuMarketplace } from "@/components/hosting-gpu-marketplace";
import { ResourceExplorer } from "@/components/resource-explorer";
import { classifyBuyCatalogListing, partitionBuyCatalog } from "@/lib/buy-catalog";
import { resourceListings, suppliers } from "@/lib/data";
import { isBuyCatalogV2Enabled } from "@/lib/server/buy-catalog-feature";
import { isHostingV2Enabled } from "@/lib/server/hosting-v2-feature";
import { requireHostingV2TransactionCapability } from "@/lib/server/hosting-v2-transaction-gate";
import { manualDeliveryIntakeEnabled } from "@/lib/server/manual-delivery-intake";

export const metadata: Metadata = {
  title: "GPU 算力目录",
  description: "查看供应商 GPU 报价，登录后提交询价与人工交付申请。",
};

const gpuListings = partitionBuyCatalog(resourceListings, suppliers).primary;
const gpuClassifications = Object.fromEntries(gpuListings.map((listing) => [listing.id, classifyBuyCatalogListing(listing, suppliers)]));

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
        classifications={gpuClassifications}
        heading="供应商 GPU 套餐"
        inquiryEnabled={isBuyCatalogV2Enabled() && manualDeliveryIntakeEnabled()}
        lead="查看供应商、GPU 规格和卡时参考价；选择套餐后提交询价，由平台确认库存、地域网络和人工交付条件。"
        listings={gpuListings}
      />
    </Suspense>
  );
}
