import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard"; import { authorizeSupplyWorkspaceRole } from "@/lib/server/supply-api"; import { getSupplyStore } from "@/lib/server/supply-store";
import { authorizeMarketplaceRequest } from "@/lib/server/marketplace-auth"; import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
export const dynamic = "force-dynamic";
export async function GET(request: Request, contextValue: { params: Promise<{ id: string }> }) { const context = beginApiRequest(request); let actor: MarketplaceActor | undefined; try {
  const role = await authorizeSupplyWorkspaceRole(request, ["supplier", "ops"], ["VERIFICATION_QUEUE_READ"]); const authorization = await authorizeMarketplaceRequest(request); actor = authorization.actor; const { id } = await contextValue.params;
  const record = await (await getSupplyStore()).getVerificationJob(actor.id, id, role === "ops"); return jsonResponse({ record }, 200, actor.responseHeaders, context);
} catch (error) { return apiErrorResponse(error, actor?.responseHeaders, context); } }
