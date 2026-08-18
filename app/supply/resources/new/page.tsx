import { permanentRedirect } from "next/navigation";
import { LEGACY_PRODUCT_REDIRECTS } from "@/lib/product-surface-policy";

export default function SupplyResourceRegistrationPage() {
  permanentRedirect(LEGACY_PRODUCT_REDIRECTS.supplyResourceNew);
}
