import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { executeSimulatedTestPayment } from "../lib/server/simulated-test-payment.ts";

const future = "2026-09-01T00:30:00.000Z";
const createdAt = "2026-08-22T00:00:00.000Z";

function pendingOrder(overrides = {}) {
  return {
    id: "ORD_TEST_SHARED_0001",
    version: 3,
    status: "AWAITING_PAYMENT",
    holdExpiresAt: future,
    allowedActions: ["SIMULATE_PAYMENT"],
    reservation: {
      id: "RES_TEST_SHARED_0001",
      state: "SUPPLIER_CONFIRMED",
      version: 2,
    },
    payment: {
      id: "PI_TEST_SHARED_0001",
      provider: "SIMULATED",
      environment: "TEST",
      merchantAccountRef: "KAI-CLOUD-TEST-CNY",
      amountCents: 1000,
      currency: "CNY",
      status: "PENDING",
      expiresAt: future,
      version: 1,
      createdAt,
      updatedAt: createdAt,
      providerPaymentId: null,
    },
    ...overrides,
  };
}

function fakeStore(order) {
  const calls = [];
  return {
    calls,
    async getOrder(actorId, orderId, role) {
      calls.push({ kind: "get", actorId, orderId, role });
      return order;
    },
    async applyPaymentEvent(context, event) {
      calls.push({ kind: "apply", context, event });
      return { record: { ...order, status: "FULFILLING" }, replayed: false };
    },
  };
}

test("the canonical command generates the only simulated provider event and never moves real funds", async () => {
  const store = fakeStore(pendingOrder());
  const result = await executeSimulatedTestPayment({
    actorId: "org_buyer_1",
    orderId: "ORD_TEST_SHARED_0001",
    idempotencyKey: "mobile-payment:test:0001",
    expectedVersion: 3,
  }, { store, now: new Date("2026-08-22T00:01:00.000Z") });

  assert.equal(result.record.status, "FULFILLING");
  assert.equal(store.calls.length, 2);
  assert.deepEqual(store.calls[0], {
    kind: "get",
    actorId: "org_buyer_1",
    orderId: "ORD_TEST_SHARED_0001",
    role: "buyer",
  });
  const applied = store.calls[1];
  assert.equal(applied.kind, "apply");
  assert.equal(applied.context.actorId, "org_buyer_1");
  assert.equal(applied.context.idempotencyKey, "mobile-payment:test:0001");
  assert.match(applied.context.payloadHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual({
    provider: applied.event.provider,
    environment: applied.event.environment,
    providerOrderId: applied.event.providerOrderId,
    amountCents: applied.event.amountCents,
    currency: applied.event.currency,
    eventType: applied.event.eventType,
    verificationMethod: applied.event.verificationMethod,
    fundsMoved: applied.event.fundsMoved,
  }, {
    provider: "SIMULATED",
    environment: "TEST",
    providerOrderId: "PI_TEST_SHARED_0001",
    amountCents: 1000,
    currency: "CNY",
    eventType: "CAPTURED",
    verificationMethod: "SERVER_GENERATED_TEST_EVENT",
    fundsMoved: false,
  });
});

test("stale, expired, and non-simulated commands fail before any payment write", async () => {
  const stale = fakeStore(pendingOrder());
  await assert.rejects(
    executeSimulatedTestPayment({ actorId: "org", orderId: "order", idempotencyKey: "payment:test:stale", expectedVersion: 2 }, { store: stale }),
    (error) => error?.code === "EXCHANGE_VERSION_CONFLICT",
  );
  assert.deepEqual(stale.calls.map((call) => call.kind), ["get"]);

  const expired = fakeStore(pendingOrder({ holdExpiresAt: "2026-08-21T23:59:59.000Z" }));
  await assert.rejects(
    executeSimulatedTestPayment({ actorId: "org", orderId: "order", idempotencyKey: "payment:test:expired", expectedVersion: 3 }, { store: expired, now: new Date(createdAt) }),
    (error) => error?.code === "EXCHANGE_PAYMENT_LATE_CAPTURE" && error?.status === 410,
  );
  assert.deepEqual(expired.calls.map((call) => call.kind), ["get"]);

  const live = fakeStore(pendingOrder({ payment: { ...pendingOrder().payment, provider: "ALIPAY", environment: "LIVE" } }));
  await assert.rejects(
    executeSimulatedTestPayment({ actorId: "org", orderId: "order", idempotencyKey: "payment:test:live", expectedVersion: 3 }, { store: live }),
    (error) => error?.code === "EXCHANGE_TEST_PAYMENT_UNAVAILABLE",
  );
  assert.deepEqual(live.calls.map((call) => call.kind), ["get"]);
});

test("a captured order reaches the store so the original idempotency receipt decides replay", async () => {
  const order = pendingOrder({
    version: 4,
    status: "FULFILLING",
    allowedActions: [],
    reservation: { ...pendingOrder().reservation, state: "COMMITTED", version: 3 },
    payment: { ...pendingOrder().payment, status: "CAPTURED", version: 2 },
  });
  const store = fakeStore(order);
  await executeSimulatedTestPayment({
    actorId: "org_buyer_1",
    orderId: order.id,
    idempotencyKey: "mobile-payment:test:0001",
    expectedVersion: 3,
  }, { store });
  assert.deepEqual(store.calls.map((call) => call.kind), ["get", "apply"]);
});

test("the browser route delegates to the canonical command instead of constructing provider events", () => {
  const route = readFileSync(new URL("../app/api/v1/orders/[id]/test-payment/route.ts", import.meta.url), "utf8");
  assert.match(route, /executeSimulatedTestPayment\(\{/u);
  assert.doesNotMatch(route, /SERVER_GENERATED_TEST_EVENT|providerEventId|providerTransactionId|applyPaymentEvent/u);
});
