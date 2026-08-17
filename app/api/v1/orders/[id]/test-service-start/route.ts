import { parseTestServiceStart } from "@/lib/exchange";
import {
  apiErrorResponse,
  beginApiRequest,
  jsonResponse,
  mutationHash,
  prepareWrite,
  readJsonBody,
  requireIdempotencyKey,
} from "@/lib/server/api-guard";
import { requireExchangeAdmin } from "@/lib/server/exchange-auth";
import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { getExchangeStore } from "@/lib/server/exchange-store";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { requireLegacyGpuMutationSimulation } from "@/lib/server/legacy-gpu-mutation-gate";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    requireLegacyGpuMutationSimulation();
    await requireExchangeAdmin(request, ["FULFILLMENT_OPERATE"]);
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    prepareWrite(request, actor);
    await persistMarketplaceSession(authorization);
    const { id } = await contextValue.params;
    const input = parseTestServiceStart(await readJsonBody(request));
    const store = await getExchangeStore();
    if (!store.testStartService) {
      throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "测试服务启动尚未启用。");
    }
    const result = await store.testStartService(id, {
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
