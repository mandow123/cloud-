import { parseCreateRequest } from "@/lib/marketplace";
import {
  apiErrorResponse,
  beginApiRequest,
  jsonResponse,
  mutationHash,
  prepareWrite,
  readJsonBody,
  readPageQuery,
  requireIdempotencyKey,
} from "@/lib/server/api-guard";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import { bindNewEntityToOrganization, requireTradingAccountSession } from "@/lib/server/entity-ownership";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { CURATED_DEMAND_REFRESH_LABEL } from "@/lib/server/curated-market-demands";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    const query = readPageQuery(request, ["mine", "market"] as const, "mine");
    const page = query.view === "market"
      ? await authorization.store.listPublicRequests(query)
      : await authorization.store.listOwnedRequests(actor.id, query);
    const updatedAt = page.items.reduce<string | null>((latest, item) => {
      if (!latest || Date.parse(item.updatedAt) > Date.parse(latest)) return item.updatedAt;
      return latest;
    }, null);
    return jsonResponse({
      items: page.items,
      count: page.items.length,
      updatedAt,
      servedAt: new Date().toISOString(),
      source: query.view === "market" ? "KAI Cloud 匿名需求池（服务端）" : "当前访客会话",
      refreshAfterSeconds: query.view === "market" ? 60 : null,
      refreshPolicy: query.view === "market" ? CURATED_DEMAND_REFRESH_LABEL : null,
      pageInfo: { hasMore: page.hasMore, nextCursor: page.nextCursor, limit: query.limit },
      view: query.view,
    }, 200, actor.responseHeaders, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
export async function POST(request: Request) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    const account = await requireTradingAccountSession(request);
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    prepareWrite(request, actor);
    await persistMarketplaceSession(authorization);
    await authorization.store.consumeWriteAllowance(actor.id, "requests");
    const idempotencyKey = requireIdempotencyKey(request);
    const input = parseCreateRequest(await readJsonBody(request));
    const result = await authorization.store.createRequest({
      actorId: actor.id,
      idempotencyKey,
      payloadHash: await mutationHash(input),
    }, input);
    if (account) {
      await bindNewEntityToOrganization({
        account,
        sourceSystem: "MARKETPLACE",
        entityType: "DEMAND",
        entityId: result.record.id,
        businessIdempotencyKey: idempotencyKey,
      });
    }
    const headers = new Headers(actor.responseHeaders);
    headers.set("idempotency-replayed", String(result.replayed));
    return jsonResponse({ record: result.record, replayed: result.replayed }, result.replayed ? 200 : 201, headers, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
