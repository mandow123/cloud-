import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { authorizeSupplyWorkspaceRole } from "@/lib/server/supply-api";
import { getSupplyStore } from "@/lib/server/supply-store";
import { authorizeMarketplaceRequest } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { alipayReadiness } from "@/lib/server/alipay-live";
import { sshProvisionerReadiness } from "@/lib/server/ssh-provisioner";

export const dynamic = "force-dynamic";
export async function GET(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const context = beginApiRequest(request); let actor: MarketplaceActor | undefined;
  try {
    const role = await authorizeSupplyWorkspaceRole(request, ["buyer", "supplier", "ops"], ["FULFILLMENT_READ"]); const authorization = await authorizeMarketplaceRequest(request); actor = authorization.actor;
    const { id } = await contextValue.params; const detail = await (await getSupplyStore()).getTrialOrder(actor.id, id, role);
    const alipay = alipayReadiness();
    const ssh = sshProvisionerReadiness();
    const record = {
      ...detail,
      paymentReadiness: {
        provider: "ALIPAY",
        environment: "LIVE",
        ready: alipay.configured,
        blockers: alipay.configured ? [] : alipay.missing.map((name) => `缺少 ${name}`),
      },
      sshReadiness: {
        ready: ssh.configured,
        blockers: ssh.configured ? [] : ssh.missing.map((name) => `缺少 ${name}`),
      },
    };
    return jsonResponse({ record }, 200, actor.responseHeaders, context);
  } catch (error) { return apiErrorResponse(error, actor?.responseHeaders, context); }
}
