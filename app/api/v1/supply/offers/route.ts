import { parseCreateSupplyOffer } from "@/lib/server/supply-domain";
import { apiErrorResponse, beginApiRequest, jsonResponse, mutationHash, prepareWrite, readJsonBody, requireIdempotencyKey } from "@/lib/server/api-guard";
import { supplyWorkspaceRole } from "@/lib/server/supply-api";
import { getSupplyStore } from "@/lib/server/supply-store";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { bindNewEntityToOrganization, requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { isAgentTelemetryV1Enabled } from "@/lib/server/agent-telemetry-feature";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request); let actor: MarketplaceActor | undefined;
  try {
    const account = await requireTradingAccountSession(request);
    await supplyWorkspaceRole(request, ["supplier"]);
    const authorization = await authorizeMarketplaceRequest(request); actor = authorization.actor;
    const items = await (await getSupplyStore()).listOffers(actor.id);
    const eligibleIds = account && isAgentTelemetryV1Enabled()
      ? new Set(await (await getHostingV2Store()).telemetryEligibleApplicationIds(account.activeOrganization.id, items.map((item) => item.id), new Date().toISOString()))
      : new Set<string>();
    const records = items.map((item) => ({ ...item, telemetryConnectionEligible: eligibleIds.has(item.id) }));
    return jsonResponse({ items: records, count: records.length }, 200, actor.responseHeaders, context);
  } catch (error) { return apiErrorResponse(error, actor?.responseHeaders, context); }
}

export async function POST(request: Request) {
  const context = beginApiRequest(request); let actor: MarketplaceActor | undefined;
  try {
    const account = await requireTradingAccountSession(request);
    await supplyWorkspaceRole(request, ["supplier"]);
    const authorization = await authorizeMarketplaceRequest(request); actor = authorization.actor;
    prepareWrite(request, actor); await persistMarketplaceSession(authorization);
    const input = parseCreateSupplyOffer(await readJsonBody(request));
    const idempotencyKey = requireIdempotencyKey(request);
    const result = await (await getSupplyStore()).createOffer({
      actorId: actor.id,
      idempotencyKey,
      payloadHash: await mutationHash(input),
    }, input);
    if (account) {
      await bindNewEntityToOrganization({ account, sourceSystem: "SUPPLY_PILOT", entityType: "SUPPLY_OFFER", entityId: result.record.id, businessIdempotencyKey: idempotencyKey });
    }
    const headers = new Headers(actor.responseHeaders); headers.set("idempotency-replayed", String(result.replayed));
    return jsonResponse(result, result.replayed ? 200 : 201, headers, context);
  } catch (error) { return apiErrorResponse(error, actor?.responseHeaders, context); }
}
