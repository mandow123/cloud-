import { jsonResponse } from "@/lib/server/api-guard";
import { getMarketplaceStore } from "@/lib/server/marketplace-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await getMarketplaceStore();
    const health = await store.health();
    return jsonResponse({ status: "ok", service: "kai-cloud-marketplace", ...health });
  } catch {
    return jsonResponse({ status: "error", service: "kai-cloud-marketplace" }, 503);
  }
}
