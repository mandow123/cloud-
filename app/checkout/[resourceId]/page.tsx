import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogPurchase } from "@/components/catalog-purchase";
import { getResourceById } from "@/lib/data";

type PurchasePageProps = {
  params: Promise<{ resourceId: string }>;
};

export async function generateMetadata({ params }: PurchasePageProps): Promise<Metadata> {
  const { resourceId } = await params;
  const resource = getResourceById(resourceId);
  return resource
    ? { title: `购买 ${resource.title}`, description: `查看 ${resource.title} 的参考单价并提交购买。` }
    : { title: "资源不可购买" };
}

export default async function PurchasePage({ params }: PurchasePageProps) {
  const { resourceId } = await params;
  const resource = getResourceById(resourceId);
  if (!resource) notFound();
  return <CatalogPurchase resource={resource} />;
}
