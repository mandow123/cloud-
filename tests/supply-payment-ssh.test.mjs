import assert from "node:assert/strict";
import test from "node:test";

const MODULE_PATH = "../lib/server/supply-pilot.ts";

let contractPromise;

async function contract() {
  contractPromise ??= import(MODULE_PATH);
  try {
    return await contractPromise;
  } catch (error) {
    assert.fail(`planned supply pilot contract ${MODULE_PATH} is unavailable: ${error?.message ?? error}`);
  }
}

async function call(fn, ...args) {
  return await fn(...args);
}

async function rejectsCode(action, expectedCode) {
  await assert.rejects(
    Promise.resolve().then(action),
    (error) => error?.code === expectedCode || error?.message === expectedCode,
    `expected ${expectedCode}`,
  );
}

function alipayInput(overrides = {}) {
  return {
    config: {
      appId: "2026000000000001",
      merchantId: "2088000000000001",
      alipayPublicKey: "test-public-key",
      merchantPrivateKey: "test-private-key",
    },
    expectedOrder: {
      orderId: "order-h100-001",
      merchantOrderId: "KAI-H100-001",
      amountCents: 800,
      currency: "CNY",
    },
    notification: {
      notificationId: "notify-001",
      outTradeNo: "KAI-H100-001",
      tradeNo: "2026080622000000000001",
      tradeStatus: "TRADE_SUCCESS",
      totalAmount: "8.00",
      appId: "2026000000000001",
      sellerId: "2088000000000001",
      sign: "valid-signature",
      signType: "RSA2",
    },
    priorPayment: null,
    ...overrides,
  };
}

test("Alipay callback configuration is mandatory and missing configuration cannot mutate payment state", async () => {
  const { applyAlipayCallback } = await contract();
  let verifyCalls = 0;
  await rejectsCode(
    () => call(applyAlipayCallback, alipayInput({ config: null }), {
      verifySignature: () => { verifyCalls += 1; return true; },
    }),
    "ALIPAY_NOT_CONFIGURED",
  );
  assert.equal(verifyCalls, 0);
});

test("Alipay callback verifies server-side signature and rejects amount mismatch with no side effects", async () => {
  const { applyAlipayCallback } = await contract();
  await rejectsCode(
    () => call(applyAlipayCallback, alipayInput(), { verifySignature: () => false }),
    "ALIPAY_SIGNATURE_INVALID",
  );
  await rejectsCode(
    () => call(applyAlipayCallback, alipayInput({
      notification: { ...alipayInput().notification, totalAmount: "7.99" },
    }), { verifySignature: () => true }),
    "PAYMENT_AMOUNT_MISMATCH",
  );
});

test("a valid Alipay callback captures once and identical redelivery is idempotent", async () => {
  const { applyAlipayCallback } = await contract();
  const first = await call(applyAlipayCallback, alipayInput(), { verifySignature: () => true });
  assert.equal(first.payment.status, "CAPTURED");
  assert.equal(first.payment.amountCents, 800);
  assert.equal(first.capacityReservationsCreated, 1);
  assert.equal(first.deliveryTasksCreated, 1);

  const replay = await call(applyAlipayCallback, alipayInput({ priorPayment: first.payment }), { verifySignature: () => true });
  assert.equal(replay.replayed, true);
  assert.equal(replay.payment.paymentId, first.payment.paymentId);
  assert.equal(replay.capacityReservationsCreated, 0);
  assert.equal(replay.deliveryTasksCreated, 0);
});

test("browser return parameters are never accepted as proof of Alipay payment", async () => {
  const { applyAlipayCallback } = await contract();
  await rejectsCode(
    () => call(applyAlipayCallback, {
      ...alipayInput(),
      notification: null,
      browserReturnParams: { out_trade_no: "KAI-H100-001", trade_status: "TRADE_SUCCESS" },
    }, { verifySignature: () => true }),
    "ALIPAY_SERVER_NOTIFICATION_REQUIRED",
  );
});

test("SSH delivery keeps provisioning, credential, connection, service, and cleanup as separate states", async () => {
  const { initialSshDeliveryState, transitionSshDelivery } = await contract();
  let state = await call(initialSshDeliveryState);
  assert.equal(state.taskState, "PENDING");
  assert.equal(state.credentialState, "NONE");
  assert.equal(state.connectionState, "UNTESTED");
  assert.equal(state.serviceState, "NOT_STARTED");
  assert.equal(state.cleanupState, "NOT_REQUIRED");
  assert.equal(state.relistAllowed, false);

  state = await call(transitionSshDelivery, state, { type: "SUPPLIER_START" });
  assert.equal(state.taskState, "PROVISIONING");
  state = await call(transitionSshDelivery, state, { type: "PACKAGE_SUBMITTED" });
  assert.equal(state.taskState, "VERIFYING");
  state = await call(transitionSshDelivery, state, { type: "OPS_APPROVED", credentialExpiresAt: "2026-08-10T08:00:00.000Z" });
  assert.equal(state.taskState, "DELIVERED");
  assert.equal(state.credentialState, "READY");
  state = await call(transitionSshDelivery, state, { type: "BUYER_CLAIMED", at: "2026-08-10T00:00:00.000Z" });
  assert.equal(state.credentialState, "CLAIMED");
  state = await call(transitionSshDelivery, state, { type: "CONNECTION_PASSED", at: "2026-08-10T00:01:00.000Z" });
  assert.equal(state.connectionState, "PASSED");
  assert.equal(state.taskState, "DELIVERED", "connection success must not start service or billing");
  assert.equal(state.serviceState, "NOT_STARTED");

  state = await call(transitionSshDelivery, state, {
    type: "SERVICE_STARTED",
    at: "2026-08-10T00:02:00.000Z",
    orderStartAt: "2026-08-10T00:00:00.000Z",
    orderEndAt: "2026-08-10T01:00:00.000Z",
  });
  assert.equal(state.taskState, "IN_SERVICE");
  assert.equal(state.serviceState, "ACTIVE");
  state = await call(transitionSshDelivery, state, { type: "SERVICE_COMPLETED", at: "2026-08-10T01:00:00.000Z" });
  assert.equal(state.taskState, "COMPLETED");
  assert.equal(state.cleanupState, "REQUIRED");
  assert.equal(state.relistAllowed, false);
  state = await call(transitionSshDelivery, state, { type: "CREDENTIAL_REVOKED" });
  assert.equal(state.credentialState, "REVOKED");
  state = await call(transitionSshDelivery, state, { type: "DATA_CLEANED" });
  assert.equal(state.cleanupState, "COMPLETED");
  assert.equal(state.relistAllowed, true);
});

test("latest failed SSH connection, expired credentials, and early relisting are blocked", async () => {
  const { initialSshDeliveryState, transitionSshDelivery } = await contract();
  let state = await call(initialSshDeliveryState);
  state = await call(transitionSshDelivery, state, { type: "SUPPLIER_START" });
  state = await call(transitionSshDelivery, state, { type: "PACKAGE_SUBMITTED" });
  state = await call(transitionSshDelivery, state, { type: "OPS_APPROVED", credentialExpiresAt: "2026-08-10T00:30:00.000Z" });
  state = await call(transitionSshDelivery, state, { type: "BUYER_CLAIMED", at: "2026-08-10T00:00:00.000Z" });
  state = await call(transitionSshDelivery, state, { type: "CONNECTION_PASSED", at: "2026-08-10T00:01:00.000Z" });
  state = await call(transitionSshDelivery, state, { type: "CONNECTION_FAILED", at: "2026-08-10T00:02:00.000Z" });
  await rejectsCode(
    () => call(transitionSshDelivery, state, { type: "SERVICE_STARTED", at: "2026-08-10T00:03:00.000Z", orderStartAt: "2026-08-10T00:00:00.000Z", orderEndAt: "2026-08-10T01:00:00.000Z" }),
    "SSH_CONNECTION_NOT_PASSED",
  );
  await rejectsCode(() => call(transitionSshDelivery, state, { type: "DATA_CLEANED" }), "SSH_CREDENTIAL_REVOKE_REQUIRED");

  const passed = await call(transitionSshDelivery, state, { type: "CONNECTION_PASSED", at: "2026-08-10T00:04:00.000Z" });
  await rejectsCode(
    () => call(transitionSshDelivery, passed, { type: "SERVICE_STARTED", at: "2026-08-10T00:31:00.000Z", orderStartAt: "2026-08-10T00:00:00.000Z", orderEndAt: "2026-08-10T01:00:00.000Z" }),
    "SSH_CREDENTIAL_EXPIRED",
  );
});
