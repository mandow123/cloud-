import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BuyWorkspace } from "@/components/buy-workspace";
import { partitionBuyCatalog } from "@/lib/buy-catalog";
import { resourceListings, suppliers } from "@/lib/data";
import { isBuyCatalogV2Enabled } from "@/lib/server/buy-catalog-feature";
import { manualDeliveryIntakeEnabled } from "@/lib/server/manual-delivery-intake";

export const metadata: Metadata = {
  title: "选购 GPU 算力",
  description: "查看供应商 GPU 套餐、规格与卡时参考价，登录后提交询价。",
};

export default function BuyPage() {
  if (!isBuyCatalogV2Enabled()) redirect("/gpu");
  const catalog = partitionBuyCatalog(resourceListings, suppliers);
  return <BuyWorkspace inquiryEnabled={manualDeliveryIntakeEnabled()} primaryListings={catalog.primary} referenceLeads={catalog.referenceLeads} showLiveInventory />;
}
