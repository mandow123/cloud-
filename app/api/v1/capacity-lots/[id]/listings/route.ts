import { parseCreateListingVersion } from "@/lib/exchange";
import {
  apiErrorResponse,
  beginApiRequest,
  jsonResponse,
  mutationHash,
  prepareWrite,
  readJsonBody,
  requireIdempotencyKey,
} from "@/lib/server/api-guard";
import { MarketplaceInputError } from "@/lib/marketplace";
import { requireExchangeRole } from "@/lib/server/exchange-auth";
import { getExchangeStore } from "@/lib/server/exchange-store";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { bindNewEntityToOrganization, requireTradingAccountSession } from "@/lib/server/entity-ownership";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    const account = await requireTradingAccountSession(request);
    requireExchangeRole(request, "supplier");
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    prepareWrite(request, actor);
    await persistMarketplaceSession(authorization);
    const { id } = await contextValue.params;
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new MarketplaceInputError("请求内容必须是对象。");
    const suppliedLotId = (body as Record<string, unknown>).capacityLotId;
    if (suppliedLotId !== undefined && suppliedLotId !== id) {
      throw new MarketplaceInputError("路径中的容量批次与提交内容不一致。", "capacityLotId");
    }
    const input = parseCreateListingVersion({ ...(body as Record<string, unknown>), capacityLotId: id });
    const idempotencyKey = requireIdempotencyKey(request);
    const result = await (await getExchangeStore()).createListing({
      actorId: actor.id,
      idempotencyKey,
      payloadHash: await mutationHash(input),
    }, input);
    if (account) await bindNewEntityToOrganization({ account, sourceSystem: "EXCHANGE", entityType: "LISTING_VERSION", entityId: result.record.id, businessIdempotencyKey: idempotencyKey });
    const headers = new Headers(actor.responseHeaders);
    headers.set("idempotency-replayed", String(result.replayed));
    return jsonResponse({ record: result.record, replayed: result.replayed }, result.replayed ? 200 : 201, headers, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
