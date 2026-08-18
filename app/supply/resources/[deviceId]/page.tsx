import { permanentRedirect } from "next/navigation";
import { LEGACY_PRODUCT_REDIRECTS } from "@/lib/product-surface-policy";

export default async function SupplyResourceDetailPage({ params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  permanentRedirect(LEGACY_PRODUCT_REDIRECTS.supplyResourceDetail(deviceId));
}
