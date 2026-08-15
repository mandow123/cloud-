import { parseSupplierConfirmation } from "@/lib/exchange";
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

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    await requireExchangeRole(request, "supplier");
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    prepareWrite(request, actor);
    await persistMarketplaceSession(authorization);
    const { id } = await contextValue.params;
    const input = parseSupplierConfirmation(await readJsonBody(request));
    const result = await (await getExchangeStore()).confirmOrder(id, {
      actorId: actor.id,
      idempotencyKey: requireIdempotencyKey(request),
      payloadHash: await mutationHash({ orderId: id, ...input }),
    }, input);
    const headers = new Headers(actor.responseHeaders);
    headers.set("idempotency-replayed", String(result.replayed));
    return jsonResponse({ record: result.record, replayed: result.replayed }, 200, headers, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
