import { parseTrialOrder } from "@/lib/server/supply-domain";
import { apiErrorResponse, beginApiRequest, jsonResponse, mutationHash, prepareWrite, readJsonBody, requireIdempotencyKey } from "@/lib/server/api-guard";
import { authorizeSupplyWorkspaceRole, supplyWorkspaceRole } from "@/lib/server/supply-api";
import { getSupplyStore } from "@/lib/server/supply-store";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { bindNewEntityToOrganization, requireTradingAccountSession } from "@/lib/server/entity-ownership";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const context = beginApiRequest(request); let actor: MarketplaceActor | undefined;
  try {
    const role = await authorizeSupplyWorkspaceRole(request, ["buyer", "supplier", "ops"], ["FULFILLMENT_READ"]); const authorization = await authorizeMarketplaceRequest(request); actor = authorization.actor;
    const items = await (await getSupplyStore()).listTrialOrders(actor.id, role);
    return jsonResponse({ items, count: items.length }, 200, actor.responseHeaders, context);
  } catch (error) { return apiErrorResponse(error, actor?.responseHeaders, context); }
}
export async function POST(request: Request) {
  const context = beginApiRequest(request); let actor: MarketplaceActor | undefined;
  try {
    const account = await requireTradingAccountSession(request);
    supplyWorkspaceRole(request, ["buyer"]); const authorization = await authorizeMarketplaceRequest(request); actor = authorization.actor;
    prepareWrite(request, actor); await persistMarketplaceSession(authorization); const input = parseTrialOrder(await readJsonBody(request));
    const idempotencyKey = requireIdempotencyKey(request);
    const result = await (await getSupplyStore()).createTrialOrder({ actorId: actor.id, idempotencyKey, payloadHash: await mutationHash(input) }, input);
    if (account) await bindNewEntityToOrganization({ account, sourceSystem: "SUPPLY_PILOT", entityType: "ORDER", entityId: result.record.id, businessIdempotencyKey: idempotencyKey });
    const headers = new Headers(actor.responseHeaders); headers.set("idempotency-replayed", String(result.replayed));
    return jsonResponse(result, result.replayed ? 200 : 201, headers, context);
  } catch (error) { return apiErrorResponse(error, actor?.responseHeaders, context); }
}
