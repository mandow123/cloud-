import { parseCreateResourceAsset } from "@/lib/exchange";
import {
  apiErrorResponse,
  beginApiRequest,
  jsonResponse,
  mutationHash,
  prepareWrite,
  readJsonBody,
  requireIdempotencyKey,
} from "@/lib/server/api-guard";
import { requireExchangeRole } from "@/lib/server/exchange-auth";
import { getExchangeStore } from "@/lib/server/exchange-store";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { bindNewEntityToOrganization, requireTradingAccountSession } from "@/lib/server/entity-ownership";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    await requireExchangeRole(request, "supplier");
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    const items = await (await getExchangeStore()).listSupplierResources(actor.id);
    return jsonResponse({ items, count: items.length }, 200, actor.responseHeaders, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    const account = await requireTradingAccountSession(request);
    await requireExchangeRole(request, "supplier");
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    prepareWrite(request, actor);
    await persistMarketplaceSession(authorization);
    const input = parseCreateResourceAsset(await readJsonBody(request));
    const idempotencyKey = requireIdempotencyKey(request);
    const result = await (await getExchangeStore()).createResource({
      actorId: actor.id,
      idempotencyKey,
      payloadHash: await mutationHash(input),
    }, input);
    if (account) await bindNewEntityToOrganization({ account, sourceSystem: "EXCHANGE", entityType: "RESOURCE_ASSET", entityId: result.record.id, businessIdempotencyKey: idempotencyKey });
    const headers = new Headers(actor.responseHeaders);
    headers.set("idempotency-replayed", String(result.replayed));
    return jsonResponse({ record: result.record, replayed: result.replayed }, result.replayed ? 200 : 201, headers, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
