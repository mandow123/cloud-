import { alipayReadiness } from "@/lib/server/alipay-live";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { authorizeMarketplaceRequest } from "@/lib/server/marketplace-auth";
import { getSupplyStore } from "@/lib/server/supply-store";
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
