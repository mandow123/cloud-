import { parseTestPaymentRequest, type ApplyPaymentEvent } from "@/lib/exchange";
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
    await requireExchangeRole(request, "buyer");
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    prepareWrite(request, actor);
    await persistMarketplaceSession(authorization);
    const { id } = await contextValue.params;
    const input = parseTestPaymentRequest(await readJsonBody(request));
    const store = await getExchangeStore();
    const order = await store.getOrder(actor.id, id, "buyer");
    if (!order.payment || order.payment.provider !== "SIMULATED" || order.payment.environment !== "TEST") {
      throw new ExchangeDomainError("EXCHANGE_TEST_PAYMENT_UNAVAILABLE", 409, "该订单当前不能执行测试支付。");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const seed = await mutationHash({ actorId: actor.id, orderId: id, idempotencyKey });
    const eventAt = order.payment.createdAt;
    const event: ApplyPaymentEvent = {
      provider: "SIMULATED",
      environment: "TEST",
      providerEventId: `SIM-EVT-${seed.slice(0, 40)}`,
      providerTransactionId: `SIM-TXN-${seed.slice(0, 40)}`,
      providerOrderId: order.payment.id,
      merchantAccountRef: order.payment.merchantAccountRef,
      eventType: "CAPTURED",
      amountCents: order.payment.amountCents,
      currency: order.payment.currency,
      occurredAt: eventAt,
      rawPayloadDigest: `sha256:${seed}`,
      verificationMethod: "SERVER_GENERATED_TEST_EVENT",
      verifiedAt: eventAt,
      fundsMoved: false,
    };
    if (order.payment.status !== "CAPTURED" && order.version !== input.expectedVersion) {
      throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "订单版本已变化，请刷新后重试。");
    }
    if (order.payment.status !== "PENDING" && order.payment.status !== "CAPTURED") {
      throw new ExchangeDomainError("EXCHANGE_TEST_PAYMENT_UNAVAILABLE", 409, "该订单当前不能执行测试支付。");
    }
    const result = await store.applyPaymentEvent({
      actorId: actor.id,
      idempotencyKey,
      payloadHash: await mutationHash(event),
    }, event);
    const headers = new Headers(actor.responseHeaders);
    headers.set("idempotency-replayed", String(result.replayed));
    return jsonResponse({ record: result.record, replayed: result.replayed }, 200, headers, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
