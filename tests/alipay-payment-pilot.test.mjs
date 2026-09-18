import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { alipayPilotAccess, alipayPilotOrganizations } from "../lib/server/alipay-payment-pilot.ts";

function keys() {
  const merchant = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const provider = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { merchant, provider };
}

function environment() {
  const { merchant, provider } = keys();
  return {
    KAI_PAYMENT_PILOT_ENABLED: "1",
    KAI_ALIPAY_ENABLED: "1",
    KAI_ALIPAY_RECONCILIATION_ENABLED: "1",
    KAI_ALIPAY_APP_ID: "2026000000000001",
    KAI_ALIPAY_PRIVATE_KEY: merchant.privateKey,
    KAI_ALIPAY_PUBLIC_KEY: provider.publicKey,
    KAI_ALIPAY_SELLER_ID: "2088000000000001",
    KAI_ALIPAY_APPROVAL_REFERENCE: "CHG-2026-09-18-ALIPAY",
    KAI_ALIPAY_CREDENTIAL_VERSION: "ALIPAY-2026-09-18-01",
    KAI_ALIPAY_GATEWAY: "https://openapi.alipay.com/gateway.do",
    KAI_PUBLIC_ORIGIN: "https://cloud.kai.com",
    KAI_ALIPAY_PILOT_ORGANIZATIONS: "org-one,org-two",
  };
}

test("Alipay pilot requires a unique bounded organization allowlist", () => {
  const env = environment();
  assert.deepEqual(alipayPilotOrganizations(env), ["org-one", "org-two"]);
  assert.deepEqual(alipayPilotOrganizations({ ...env, KAI_ALIPAY_PILOT_ORGANIZATIONS: "org-one,org-one" }), []);
  assert.deepEqual(alipayPilotOrganizations({ ...env, KAI_ALIPAY_PILOT_ORGANIZATIONS: "" }), []);
});

test("Alipay pilot requires checkout readiness and the exact organization", () => {
  const env = environment();
  assert.equal(alipayPilotAccess("org-one", env).ready, true);
  assert.equal(alipayPilotAccess("org-other", env).ready, false);
  assert.equal(alipayPilotAccess("org-one", { ...env, KAI_ALIPAY_ENABLED: "0" }).ready, false);
});
