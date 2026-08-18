import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { authorizeSupplyWorkspaceRole } from "@/lib/server/supply-api";
import { getSupplyStore } from "@/lib/server/supply-store";
import { authorizeMarketplaceRequest } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { sshProvisionerReadiness } from "@/lib/server/ssh-provisioner";
import { cnyCentsToCardHourMicros } from "@/lib/card-hours";

export const dynamic = "force-dynamic";
export async function GET(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const context = beginApiRequest(request); let actor: MarketplaceActor | undefined;
  try {
    const role = await authorizeSupplyWorkspaceRole(request, ["buyer", "supplier", "ops"], ["FULFILLMENT_READ"]); const authorization = await authorizeMarketplaceRequest(request); actor = authorization.actor;
    const { id } = await contextValue.params; const detail = await (await getSupplyStore()).getTrialOrder(actor.id, id, role);
    const ssh = sshProvisionerReadiness();
    const record = {
      ...detail,
      paymentReadiness: {
        provider: "KAI_CARD_HOUR",
        environment: "LIVE",
        ready: true,
        blockers: [],
        assetCode: "KAI_CREDIT_HOUR",
        amountMicros: cnyCentsToCardHourMicros(detail.order.amountCents),
        rate: { cardHours: "1", cny: "1.002" },
      },
      sshReadiness: {
        ready: ssh.configured,
        blockers: ssh.configured ? [] : ssh.missing.map((name) => `缺少 ${name}`),
      },
    };
    return jsonResponse({ record }, 200, actor.responseHeaders, context);
  } catch (error) { return apiErrorResponse(error, actor?.responseHeaders, context); }
}
