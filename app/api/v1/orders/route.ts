import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { getExchangeStore } from "@/lib/server/exchange-store";
import { authorizeMarketplaceRequest } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    const role = request.headers.get("x-kai-workspace-role");
    if (role !== "buyer" && role !== "supplier") {
      throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "订单列表仅允许采购方或供应商工作台读取。");
    }
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    const items = await (await getExchangeStore()).listOrders(actor.id, role);
    return jsonResponse({ items, count: items.length }, 200, actor.responseHeaders, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
