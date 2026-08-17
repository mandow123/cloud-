import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { hostingPublicOfferClientView, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    const records = (await (await getHostingV2Store()).listPublicOffers(new Date().toISOString())).map(hostingPublicOfferClientView);
    return jsonResponse({ records, count: records.length, updatedAt: new Date().toISOString() }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
