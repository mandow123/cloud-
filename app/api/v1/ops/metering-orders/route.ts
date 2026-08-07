import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireExchangeAdmin } from "@/lib/server/exchange-auth";
import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { getExchangeStore } from "@/lib/server/exchange-store";
import { authorizeMarketplaceRequest } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    await requireExchangeAdmin(request, ["FULFILLMENT_READ"]);
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    const store = await getExchangeStore();
    if (!store.listOpsMeteringOrders) {
      throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "计量工作台尚未启用。");
    }
    const items = await store.listOpsMeteringOrders();
    return jsonResponse({ items, count: items.length }, 200, actor.responseHeaders, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
