import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getResourceById } from "@/lib/data";

type PurchasePageProps = {
  params: Promise<{ resourceId: string }>;
};

export async function generateMetadata({ params }: PurchasePageProps): Promise<Metadata> {
  const { resourceId } = await params;
  const resource = getResourceById(resourceId);
  return resource
    ? { title: `提交 ${resource.title} 算力需求`, description: `基于 ${resource.title} 的历史参考档案提交算力需求。` }
    : { title: "目录资源不存在" };
}

export default async function PurchasePage({ params }: PurchasePageProps) {
  const { resourceId } = await params;
  const resource = getResourceById(resourceId);
  if (!resource) notFound();
  permanentRedirect(`/request?${new URLSearchParams({
    listing: resource.id,
    mode: resource.dealModes[0],
    category: resource.category,
    unit: resource.pricingUnit,
    title: resource.title,
    region: resource.region,
  }).toString()}`);
}
