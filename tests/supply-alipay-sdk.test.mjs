import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  alipayReadiness,
  createAlipayCheckoutUrl,
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
  KAI_ALIPAY_ENABLED: "1",
  KAI_ALIPAY_APP_ID: "2026000000000001",
  KAI_ALIPAY_PRIVATE_KEY: merchant.privateKey,
  KAI_ALIPAY_PRIVATE_KEY_TYPE: "PKCS8",
  KAI_ALIPAY_PUBLIC_KEY: alipay.publicKey,
  KAI_ALIPAY_SELLER_ID: "2088000000000001",
  KAI_ALIPAY_GATEWAY: "https://openapi.alipay.com/gateway.do",
  KAI_PUBLIC_ORIGIN: "http://localhost:3012",
};

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

test("Alipay notification requires RSA2 signature and yields one server-verifiable event", async () => {
  const body = signedNotification();
  const event = await verifyAlipayNotification(body, body.toString(), environment);
  assert.equal(event.eventType, "CAPTURED");
  assert.equal(event.amountCents, 800);
  assert.equal(event.providerOrderId, "KAI-H100-ORDER-001");
  assert.equal(event.merchantAccountRef, environment.KAI_ALIPAY_SELLER_ID);
  assert.equal(event.fundsMoved, true);

  const tampered = new URLSearchParams(body);
  tampered.set("total_amount", "7.99");
  await assert.rejects(
    verifyAlipayNotification(tampered, tampered.toString(), environment),
    (error) => error?.code === "ALIPAY_SIGNATURE_INVALID",
  );
});
