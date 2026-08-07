import { alipayReadiness } from "@/lib/server/alipay-live";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { authorizeMarketplaceRequest } from "@/lib/server/marketplace-auth";
import { getSupplyStore } from "@/lib/server/supply-store";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";

export const dynamic = "force-dynamic";

export async function GET(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    const role = request.headers.get("x-kai-workspace-role");
    if (role !== "buyer" && role !== "supplier") {
      throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "支付状态仅允许订单双方读取。");
    }
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    const { id } = await contextValue.params;
    const detail = await (await getSupplyStore()).getTrialOrder(actor.id, id, role);
    const readiness = alipayReadiness();
    return jsonResponse({
      orderId: detail.order.id,
      orderStatus: detail.order.status,
      amountCents: detail.order.amountCents,
      currency: detail.order.currency,
      payment: detail.payment,
      providerConfigured: readiness.configured,
    }, 200, actor.responseHeaders, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
