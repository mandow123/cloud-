import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogPurchase } from "@/components/catalog-purchase";
import { getResourceById } from "@/lib/data";
import { manualDeliveryIntakeEnabled } from "@/lib/server/manual-delivery-intake";

type PurchasePageProps = {
  params: Promise<{ resourceId: string }>;
};

export async function generateMetadata({ params }: PurchasePageProps): Promise<Metadata> {
  const { resourceId } = await params;
  const resource = getResourceById(resourceId);
  return resource
    ? { title: `询价 ${resource.title}`, description: `查看 ${resource.title} 的目录参考价并提交询价意向。` }
    : { title: "目录资源不存在" };
}

export default async function PurchasePage({ params }: PurchasePageProps) {
  const { resourceId } = await params;
  const resource = getResourceById(resourceId);
  if (!resource) notFound();
  return <CatalogPurchase manualDeliveryEnabled={manualDeliveryIntakeEnabled()} resource={resource} />;
}
