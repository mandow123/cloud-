import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  alipayReconciliationReadiness,
  alipayReadiness,
  createAlipayCheckoutUrl,
  queryVerifiedAlipayTrade,
  refundAlipayTrade,
  verifyAlipayNotification,
} from "../lib/server/alipay-live.ts";

function keyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

const merchant = keyPair();
const alipay = keyPair();
const environment = {
  KAI_PAYMENT_PILOT_ENABLED: "1",
  KAI_ALIPAY_ENABLED: "1",
  KAI_ALIPAY_RECONCILIATION_ENABLED: "1",
  KAI_ALIPAY_APP_ID: "2026000000000001",
  KAI_ALIPAY_PRIVATE_KEY: merchant.privateKey,
  KAI_ALIPAY_PRIVATE_KEY_TYPE: "PKCS8",
  KAI_ALIPAY_PUBLIC_KEY: alipay.publicKey,
  KAI_ALIPAY_SELLER_ID: "2088000000000001",
  KAI_ALIPAY_CREDENTIAL_VERSION: "alipay-live-v1",
  KAI_ALIPAY_APPROVAL_REFERENCE: "PAY-APPROVAL-20260918",
  KAI_ALIPAY_GATEWAY: "https://openapi.alipay.com/gateway.do",
  KAI_PUBLIC_ORIGIN: "https://cloud.kai.com",
};

test("runtime pilot gate closes Alipay checkout even when the provider switch is one", () => {
  assert.equal(alipayReadiness({ ...environment, KAI_PAYMENT_PILOT_ENABLED: "0" }).canCreatePayment, false);
});

test("Alipay LIVE readiness blocks missing merchant configuration", () => {
  const readiness = alipayReadiness({ KAI_ALIPAY_APP_ID: "only-one-field" });
  assert.equal(readiness.configured, false);
  assert.ok(readiness.missing.includes("KAI_ALIPAY_PRIVATE_KEY"));
  assert.ok(readiness.missing.includes("KAI_PUBLIC_ORIGIN"));
  assert.throws(
    () => createAlipayCheckoutUrl({ orderId: "KAI-H100-ORDER-001", amountCents: 800, subject: "H100" }, {}),
    (error) => error?.code === "ALIPAY_NOT_CONFIGURED",
  );
});

test("Alipay remains fail-closed when credentials exist but the trial gate is disabled", () => {
  const readiness = alipayReadiness({ ...environment, KAI_ALIPAY_ENABLED: "0" });
  assert.equal(readiness.configured, true);
  assert.equal(readiness.enabled, false);
  assert.equal(readiness.canCreatePayment, false);
  assert.throws(
    () => createAlipayCheckoutUrl({ orderId: "KAI-H100-ORDER-002", amountCents: 800, subject: "H100" }, { ...environment, KAI_ALIPAY_ENABLED: "0" }),
    (error) => error?.code === "ALIPAY_NOT_CONFIGURED",
  );
});

test("Alipay readiness rejects plausible-looking but invalid production configuration", () => {
  const invalidEnvironments = [
    { ...environment, KAI_ALIPAY_APP_ID: "app_2026000000001" },
    { ...environment, KAI_ALIPAY_SELLER_ID: "2088-not-a-seller" },
    { ...environment, KAI_ALIPAY_GATEWAY: "https://example.com/gateway.do" },
    { ...environment, KAI_ALIPAY_PRIVATE_KEY_TYPE: "PEM" },
    { ...environment, KAI_PUBLIC_ORIGIN: "http://cloud.kai.com" },
    { ...environment, KAI_PUBLIC_ORIGIN: "https://cloud.kai.com/callback" },
    { ...environment, KAI_ALIPAY_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----" },
    { ...environment, KAI_ALIPAY_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\nnot-a-key\n-----END PUBLIC KEY-----" },
    { ...environment, KAI_ALIPAY_CREDENTIAL_VERSION: "", KAI_ALIPAY_CREDENTIAL_ROTATED_AT: "" },
    { ...environment, KAI_ALIPAY_CREDENTIAL_VERSION: "", KAI_ALIPAY_CREDENTIAL_ROTATED_AT: "2099-01-01T00:00:00.000Z" },
    { ...environment, KAI_ALIPAY_APPROVAL_REFERENCE: "short" },
  ];
  for (const invalid of invalidEnvironments) {
    const readiness = alipayReadiness(invalid);
    assert.equal(readiness.configured, false);
    assert.equal(readiness.canCreatePayment, false);
    assert.equal(readiness.canReconcilePayment, false);
  }
});

test("checkout and reconciliation use independent gates", () => {
  const reconciliationOnly = { ...environment, KAI_ALIPAY_ENABLED: "0", KAI_ALIPAY_RECONCILIATION_ENABLED: "1" };
  const readiness = alipayReadiness(reconciliationOnly);
  assert.equal(readiness.canCreatePayment, false);
  assert.equal(readiness.canReconcilePayment, true);
  assert.equal(alipayReconciliationReadiness(reconciliationOnly).enabled, true);
  assert.equal(alipayReconciliationReadiness(reconciliationOnly).canReconcilePayment, true);
  assert.throws(
    () => createAlipayCheckoutUrl({ orderId: "KAI-H100-ORDER-003", amountCents: 800, subject: "H100" }, reconciliationOnly),
    (error) => error?.code === "ALIPAY_NOT_CONFIGURED",
  );
});

test("Alipay official SDK creates a signed page-pay URL from the server order snapshot", () => {
  const result = createAlipayCheckoutUrl({
    orderId: "KAI-H100-ORDER-001",
    amountCents: 800,
    subject: "KAI Cloud 8×H100 整机独占 1 小时",
  }, environment);
  const checkout = new URL(result.checkoutUrl);
  assert.equal(checkout.origin, "https://openapi.alipay.com");
  assert.equal(checkout.searchParams.get("method"), "alipay.trade.page.pay");
  assert.equal(checkout.searchParams.get("app_id"), environment.KAI_ALIPAY_APP_ID);
  assert.ok(checkout.searchParams.get("sign"));
  const bizContent = JSON.parse(checkout.searchParams.get("biz_content"));
  assert.equal(bizContent.out_trade_no, "KAI-H100-ORDER-001");
  assert.equal(bizContent.total_amount, "8.00");
  assert.equal(result.amountCents, 800);
});

function signedNotification(overrides = {}) {
  const payload = {
    app_id: environment.KAI_ALIPAY_APP_ID,
    seller_id: environment.KAI_ALIPAY_SELLER_ID,
    notify_id: "notify-h100-001",
    notify_time: "2026-08-06 15:00:00",
    out_trade_no: "KAI-H100-ORDER-001",
    trade_no: "2026080622000000000001",
    trade_status: "TRADE_SUCCESS",
    total_amount: "8.00",
    sign_type: "RSA2",
    ...overrides,
  };
  const signContent = Object.keys(payload).sort().map((key) => `${key}=${payload[key]}`).join("&");
  const signer = createSign("RSA-SHA256");
  signer.update(signContent, "utf8");
  const body = new URLSearchParams(payload);
  body.set("sign", signer.sign(alipay.privateKey, "base64"));
  return body;
}

test("Alipay notification remains available when new checkout is disabled", async () => {
  const body = signedNotification();
  const reconciliationOnly = { ...environment, KAI_ALIPAY_ENABLED: "0", KAI_ALIPAY_RECONCILIATION_ENABLED: "1" };
  const event = await verifyAlipayNotification(body, body.toString(), reconciliationOnly);
  assert.equal(event.eventType, "CAPTURED");
  assert.equal(event.amountCents, 800);
  assert.equal(event.providerOrderId, "KAI-H100-ORDER-001");
  assert.equal(event.merchantAccountRef, environment.KAI_ALIPAY_SELLER_ID);
  assert.match(event.providerEventId, /^alipay:notify:/u);
  assert.equal(event.fundsMoved, true);

  const tampered = new URLSearchParams(body);
  tampered.set("total_amount", "7.99");
  await assert.rejects(
    verifyAlipayNotification(tampered, tampered.toString(), reconciliationOnly),
    (error) => error?.code === "ALIPAY_SIGNATURE_INVALID",
  );
});

function queriedTrade(overrides = {}) {
  return {
    code: "10000",
    msg: "Success",
    out_trade_no: "KAI-H100-ORDER-001",
    trade_no: "2026091822000000000001",
    trade_status: "TRADE_SUCCESS",
    total_amount: "8.00",
    send_pay_date: "2026-09-18 10:20:30",
    ...overrides,
  };
}

test("verified query works with checkout disabled and normalizes supported statuses", async () => {
  const reconciliationOnly = { ...environment, KAI_ALIPAY_ENABLED: "0", KAI_ALIPAY_RECONCILIATION_ENABLED: "1" };
  for (const [tradeStatus, eventType, fundsMoved] of [
    ["TRADE_SUCCESS", "CAPTURED", true],
    ["TRADE_FINISHED", "CAPTURED", true],
    ["TRADE_CLOSED", "CLOSED", false],
    ["WAIT_BUYER_PAY", "PENDING", false],
  ]) {
    let invocation;
    const event = await queryVerifiedAlipayTrade(
      { orderId: "KAI-H100-ORDER-001", amountCents: 800 },
      reconciliationOnly,
      async (...args) => {
        invocation = args;
        return queriedTrade({ trade_status: tradeStatus });
      },
    );
    assert.deepEqual(invocation, [
      "alipay.trade.query",
      { bizContent: { outTradeNo: "KAI-H100-ORDER-001" } },
      { validateSign: true },
    ]);
    assert.equal(event.eventType, eventType);
    assert.equal(event.fundsMoved, fundsMoved);
    assert.equal(event.providerTransactionId, "2026091822000000000001");
    assert.match(event.providerEventId, /^alipay:query:/u);
    assert.equal(event.amountCents, 800);
    assert.match(event.rawPayloadDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(event.verificationMethod, "ALIPAY_RSA2_ORDER_QUERY");
  }
});

test("verified query rejects order, amount, and status conflicts", async () => {
  for (const [overrides, code] of [
    [{ out_trade_no: "KAI-H100-ORDER-999" }, "ALIPAY_TRADE_MISMATCH"],
    [{ total_amount: "8.01" }, "ALIPAY_TRADE_MISMATCH"],
    [{ trade_status: "UNKNOWN" }, "ALIPAY_TRADE_INVALID"],
    [{ trade_status: "" }, "ALIPAY_TRADE_INVALID"],
  ]) {
    await assert.rejects(
      queryVerifiedAlipayTrade(
        { orderId: "KAI-H100-ORDER-001", amountCents: 800 },
        environment,
        async () => queriedTrade(overrides),
      ),
      (error) => error?.code === code,
    );
  }
});

test("notification and query both reject before execution when reconciliation is disabled", async () => {
  const disabled = { ...environment, KAI_ALIPAY_ENABLED: "0", KAI_ALIPAY_RECONCILIATION_ENABLED: "0" };
  await assert.rejects(
    verifyAlipayNotification(signedNotification(), "signed", disabled),
    (error) => error?.code === "ALIPAY_NOT_CONFIGURED",
  );
  let calls = 0;
  await assert.rejects(
    queryVerifiedAlipayTrade(
      { orderId: "KAI-H100-ORDER-001", amountCents: 800 },
      disabled,
      async () => {
        calls += 1;
        return queriedTrade();
      },
    ),
    (error) => error?.code === "ALIPAY_NOT_CONFIGURED",
  );
  assert.equal(calls, 0);

  const checkoutOnly = { ...environment, KAI_ALIPAY_ENABLED: "1", KAI_ALIPAY_RECONCILIATION_ENABLED: "0" };
  await assert.rejects(
    verifyAlipayNotification(signedNotification(), "signed", checkoutOnly),
    (error) => error?.code === "ALIPAY_NOT_CONFIGURED",
  );
  await assert.rejects(
    queryVerifiedAlipayTrade(
      { orderId: "KAI-H100-ORDER-001", amountCents: 800 },
      checkoutOnly,
      async () => {
        calls += 1;
        return queriedTrade();
      },
    ),
    (error) => error?.code === "ALIPAY_NOT_CONFIGURED",
  );
  await assert.rejects(
    refundAlipayTrade("KAI-H100-ORDER-001", "KAI-REFUND-ORDER-001", 800, "test", checkoutOnly),
    (error) => error?.code === "ALIPAY_NOT_CONFIGURED",
  );
  assert.equal(calls, 0);
});
