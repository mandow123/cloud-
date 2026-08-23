import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createSqliteKaiPublicApiStore } from "../lib/server/public-api-store-sqlite.ts";
import { deliverOneKaiPublicWebhook } from "../lib/server/public-api-webhook.ts";
import { enforceKaiPublicApiRateLimit } from "../lib/server/public-api-rate-limit.ts";
import { kaiPublicDeviceView, kaiPublicVerificationState } from "../lib/server/public-api-service.ts";

test("signed webhook binds timestamp and exact body without leaking its secret", async () => {
  const store = await createSqliteKaiPublicApiStore(":memory:");
  const webhookSecret = "webhook-secret-at-least-32-characters";
  const clientSecret = "client-secret-at-least-32-characters";
  const previous = process.env.KAI_PUBLIC_API_CLIENTS;
  process.env.KAI_PUBLIC_API_CLIENTS = JSON.stringify([{
    clientId: "zod-sandbox-backend", secretSha256: createHash("sha256").update(clientSecret).digest("hex"),
    organizationId: "org_sandbox_supplier", organizationReference: "zod_org_sandbox", accountId: "acct_sandbox_service",
    scopes: ["resource:read", "verification:write", "agent:write"], webhookUrl: "https://zod-sandbox.example.test/webhook", webhookSecret,
  }]);
  try {
    await store.createVerification({ clientId: "zod-sandbox-backend", organizationId: "org_sandbox_supplier", organizationReference: "zod_org_sandbox", actorId: "oauth:zod-sandbox-backend", idempotencyKey: "webhook-create-0001", payloadHash: "webhook-payload-hash", now: "2026-08-20T06:00:00.000Z" }, { resourceReference: "zod_resource_001", productCode: "GPU_COMPUTE", region: "sandbox", specifications: {} });
    let captured;
    const result = await deliverOneKaiPublicWebhook({ store, now: new Date("2026-08-20T06:00:01.000Z"), http: async (url, init) => { captured = { url: String(url), init }; return new Response(null, { status: 202 }); } });
    assert.equal(result.delivered, true);
    const timestamp = captured.init.headers["x-kai-timestamp"];
    const expected = `sha256=${createHmac("sha256", webhookSecret).update(`${timestamp}.${captured.init.body}`).digest("hex")}`;
    assert.equal(captured.init.headers["x-kai-signature"], expected);
    assert.doesNotMatch(JSON.stringify(captured), new RegExp(webhookSecret, "u"));
    assert.equal(await store.nextWebhook("2026-08-20T07:00:00.000Z"), null);
  } finally {
    if (previous === undefined) delete process.env.KAI_PUBLIC_API_CLIENTS; else process.env.KAI_PUBLIC_API_CLIENTS = previous;
    store.close();
  }
});

test("unsafe webhook targets dead-letter without network access", async () => {
  const fakeStore = {
    async nextWebhook() { return { deliveryId: "delivery-unsafe", clientId: "unsafe-client", verificationId: "verification-unsafe", eventVersion: 1, payload: {}, attempt: 0, nextAttemptAt: "2026-08-20T06:00:00.000Z" }; },
    async failWebhook(deliveryId, errorCode, _next, terminal) { this.failure = { deliveryId, errorCode, terminal }; },
  };
  const previous = process.env.KAI_PUBLIC_API_CLIENTS;
  process.env.KAI_PUBLIC_API_CLIENTS = JSON.stringify([{ clientId: "unsafe-client", secretSha256: "a".repeat(64), organizationId: "org_unsafe", organizationReference: "unsafe_org", accountId: "acct_unsafe", scopes: ["resource:read"], webhookUrl: "https://127.0.0.1/private", webhookSecret: "x".repeat(32) }]);
  try {
    let called = false;
    const result = await deliverOneKaiPublicWebhook({ store: fakeStore, http: async () => { called = true; return new Response(); }, now: new Date("2026-08-20T06:00:00.000Z") });
    assert.equal(called, false);
    assert.deepEqual(fakeStore.failure, { deliveryId: "delivery-unsafe", errorCode: "WEBHOOK_TARGET_REJECTED", terminal: true });
    assert.equal(result.terminal, true);
  } finally {
    if (previous === undefined) delete process.env.KAI_PUBLIC_API_CLIENTS; else process.env.KAI_PUBLIC_API_CLIENTS = previous;
  }
});

test("device projection and verification fail closed for stale, offline and expired state", () => {
  const base = { id: "had_device", organizationId: "org", accountId: "acct", displayName: "GPU", deviceKeyId: "key", devicePublicKey: "A".repeat(43), agentVersion: "1.9.7", inventory: {}, inventoryDigest: `sha256:${"1".repeat(64)}`, status: "VERIFIED", verificationStatus: "PASSED", verificationEvidenceDigest: null, verifiedUntil: "2026-08-20T06:10:00.000Z", lastSequence: 1, lastSeenAt: "2026-08-20T06:00:00.000Z", version: 1, createdAt: "2026-08-20T05:00:00.000Z", updatedAt: "2026-08-20T06:00:00.000Z" };
  const now = new Date("2026-08-20T06:01:00.000Z");
  assert.equal(kaiPublicDeviceView(base, now).status, "ready");
  assert.equal(kaiPublicVerificationState(base, now).status, "passed");
  assert.equal(kaiPublicDeviceView({ ...base, lastSeenAt: "2026-08-20T05:00:00.000Z" }, now).status, "offline");
  assert.equal(kaiPublicVerificationState({ ...base, status: "OFFLINE" }, now).status, "failed");
  assert.equal(kaiPublicVerificationState({ ...base, verifiedUntil: "2026-08-20T05:59:00.000Z" }, now).failure.code, "VERIFICATION_EXPIRED");
});

test("application rate limit rejects an exhausted client bucket", () => {
  const now = Date.parse("2026-08-20T06:00:00.000Z");
  assert.doesNotThrow(() => enforceKaiPublicApiRateLimit("rate-test", now, 2));
  assert.doesNotThrow(() => enforceKaiPublicApiRateLimit("rate-test", now, 2));
  assert.throws(() => enforceKaiPublicApiRateLimit("rate-test", now, 2), (error) => error.code === "RATE_LIMITED" && error.status === 429);
});

test("public routes never import website session or CSRF authorization", () => {
  const routes = [
    "app/api/public/v1/resource-verifications/route.ts",
    "app/api/public/v1/resource-verifications/[verificationId]/route.ts",
    "app/api/public/v1/resource-verifications/[verificationId]/revoke/route.ts",
    "app/api/public/v1/agent-challenges/route.ts",
    "app/api/public/v1/devices/register/route.ts",
    "app/api/public/v1/devices/[deviceId]/heartbeats/route.ts",
  ];
  for (const path of routes) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /authorizeMarketplaceRequest|requireTradingAccountSession|assertAccountAuthSameOrigin|persistMarketplaceSession|x-kai-csrf/u);
  }
  assert.match(readFileSync(routes[4], "utf8"), /verifyHostingAgentSignature/u);
  assert.match(readFileSync(routes[5], "utf8"), /verifyExistingDeviceProof/u);
});
