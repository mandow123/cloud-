import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { getExchangeStore } from "@/lib/server/exchange-store";
import { authorizeMarketplaceRequest } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { supplyWorkspaceRole } from "@/lib/server/supply-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    const role = await supplyWorkspaceRole(request, ["buyer", "supplier"]);
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    const items = await (await getExchangeStore()).listOrders(actor.id, role);
    return jsonResponse({ items, count: items.length }, 200, actor.responseHeaders, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
