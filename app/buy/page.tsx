import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BuyWorkspace } from "@/components/buy-workspace";
import { partitionBuyCatalog } from "@/lib/buy-catalog";
import { resourceListings, suppliers } from "@/lib/data";
import { isBuyCatalogV2Enabled } from "@/lib/server/buy-catalog-feature";
import { manualDeliveryIntakeEnabled } from "@/lib/server/manual-delivery-intake";

export const metadata: Metadata = {
  title: "选购 GPU",
  description: "租用 GPU 算力，或购买独立确权的实体 GPU 并选择云托管。",
};

export default function BuyPage() {
  if (!isBuyCatalogV2Enabled()) redirect("/gpu");
  const catalog = partitionBuyCatalog(resourceListings, suppliers);
  return <BuyWorkspace inquiryEnabled={manualDeliveryIntakeEnabled()} primaryListings={catalog.primary} referenceLeads={catalog.referenceLeads} showLiveInventory />;
}
