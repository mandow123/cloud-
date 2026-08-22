import type { ApplyPaymentEvent, ExchangeOrder } from "../exchange.ts";
import { mutationHash } from "./api-guard.ts";
import { ExchangeDomainError } from "./exchange-errors.ts";
import { getExchangeStore, type ExchangeStore } from "./exchange-store.ts";

export type SimulatedTestPaymentCommand = Readonly<{
  actorId: string;
  orderId: string;
  idempotencyKey: string;
  expectedVersion: number;
}>;

export type SimulatedTestPaymentResult = Readonly<{
  record: ExchangeOrder;
  replayed: boolean;
}>;

type SimulatedTestPaymentDependencies = Readonly<{
  store?: ExchangeStore;
  now?: Date;
}>;

/**
 * The single command used by every simulated-payment transport.
 *
 * Browser and mobile adapters must stop at this boundary: neither transport is
 * allowed to manufacture provider events or copy the payment state machine.
 */
export async function executeSimulatedTestPayment(
  command: SimulatedTestPaymentCommand,
  dependencies: SimulatedTestPaymentDependencies = {},
): Promise<SimulatedTestPaymentResult> {
  const store = dependencies.store ?? await getExchangeStore();
  const order = await store.getOrder(command.actorId, command.orderId, "buyer");
  const payment = order.payment;
  if (!payment || payment.provider !== "SIMULATED" || payment.environment !== "TEST") {
    throw new ExchangeDomainError(
      "EXCHANGE_TEST_PAYMENT_UNAVAILABLE",
      409,
      "该订单当前不能执行测试支付。",
    );
  }

  if (payment.status !== "CAPTURED") {
    if (order.version !== command.expectedVersion) {
      throw new ExchangeDomainError(
        "EXCHANGE_VERSION_CONFLICT",
        409,
        "订单版本已变化，请刷新后重试。",
      );
    }
    if (
      payment.status !== "PENDING"
      || order.status !== "AWAITING_PAYMENT"
      || order.reservation.state !== "SUPPLIER_CONFIRMED"
      || !order.allowedActions.includes("SIMULATE_PAYMENT")
    ) {
      throw new ExchangeDomainError(
        "EXCHANGE_TEST_PAYMENT_UNAVAILABLE",
        409,
        "该订单当前不能执行测试支付。",
      );
    }
    const now = (dependencies.now ?? new Date()).toISOString();
    if (order.holdExpiresAt <= now || payment.expiresAt <= now) {
      throw new ExchangeDomainError(
        "EXCHANGE_PAYMENT_LATE_CAPTURE",
        410,
        "支付事件到达时容量预留已不可用，已进入退款与人工核对。",
      );
    }
  }

  const seed = await mutationHash({
    actorId: command.actorId,
    orderId: command.orderId,
    idempotencyKey: command.idempotencyKey,
  });
  const eventAt = payment.createdAt;
  const event: ApplyPaymentEvent = {
    provider: "SIMULATED",
    environment: "TEST",
    providerEventId: `SIM-EVT-${seed.slice(0, 40)}`,
    providerTransactionId: `SIM-TXN-${seed.slice(0, 40)}`,
    providerOrderId: payment.id,
    merchantAccountRef: payment.merchantAccountRef,
    eventType: "CAPTURED",
    amountCents: payment.amountCents,
    currency: payment.currency,
    occurredAt: eventAt,
    rawPayloadDigest: `sha256:${seed}`,
    verificationMethod: "SERVER_GENERATED_TEST_EVENT",
    verifiedAt: eventAt,
    fundsMoved: false,
  };
  return store.applyPaymentEvent({
    actorId: command.actorId,
    idempotencyKey: command.idempotencyKey,
    payloadHash: await mutationHash(event),
  }, event);
}
