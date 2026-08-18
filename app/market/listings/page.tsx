import { redirect } from "next/navigation";
import { LEGACY_PRODUCT_REDIRECTS } from "@/lib/product-surface-policy";

export default function LegacyMarketListingsPage() {
  redirect(LEGACY_PRODUCT_REDIRECTS.marketListings);
}
