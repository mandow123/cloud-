import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { getExchangeStore } from "@/lib/server/exchange-store";
import { authorizeMarketplaceRequest } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { supplyWorkspaceRole } from "@/lib/server/supply-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    const role = await supplyWorkspaceRole(request, ["buyer", "supplier"]);
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    const { id } = await contextValue.params;
    const record = await (await getExchangeStore()).getOrder(actor.id, id, role);
    return jsonResponse({ record }, 200, actor.responseHeaders, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
