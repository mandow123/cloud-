import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { hostingPublicOfferClientView, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { readHostingV2TransactionAvailability } from "@/lib/server/hosting-v2-transaction-gate";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    const store = await getHostingV2Store();
    const [offers, transaction] = await Promise.all([
      store.listPublicOffers(new Date().toISOString()),
      readHostingV2TransactionAvailability(),
    ]);
    const records = offers.map(hostingPublicOfferClientView);
    return jsonResponse({ records, count: records.length, updatedAt: new Date().toISOString(), transaction }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
