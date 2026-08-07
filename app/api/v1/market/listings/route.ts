import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { getExchangeStore } from "@/lib/server/exchange-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    const items = await (await getExchangeStore()).listMarketListings();
    return jsonResponse({ items, count: items.length, updatedAt: new Date().toISOString() }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
