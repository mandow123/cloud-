import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { parseKaiPublicApiTokenRequest } from "../lib/server/public-api-auth.ts";
import { requireKaiPublicApiEnabled, requireKaiPublicApiHttps } from "../lib/server/public-api-feature.ts";
import { deliverOneKaiPublicWebhook } from "../lib/server/public-api-webhook.ts";

const clientId = "zod-sandbox-backend";
const clientSecret = "sandbox secret with plus-compatible encoding";
const baseEnvironment = {
  KAI_ENVIRONMENT: "SANDBOX",
  KAI_PUBLIC_API_ENABLED: "1",
  KAI_PUBLIC_API_CLIENTS: JSON.stringify([{
    clientId,
    secretSha256: createHash("sha256").update(clientSecret).digest("hex"),
    organizationId: "org_sandbox_supplier",
    organizationReference: "zod_org_sandbox",
    accountId: "acct_sandbox_service",
    scopes: ["resource:read", "verification:write"],
    webhookUrl: "https://zod-sandbox.example.test/webhook",
    webhookSecret: "webhook-secret-at-least-32-characters",
  }]),
};

function tokenRequest(body, authorization) {
  return new Request("https://sandbox-api.example.test/api/public/v1/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(authorization ? { authorization } : {}) },
    body,
  });
}

test("production requires the independent gateway rate-limit assertion", () => {
  const production = { KAI_ENVIRONMENT: "PRODUCTION", KAI_PUBLIC_API_ENABLED: "1" };
  assert.throws(() => requireKaiPublicApiEnabled(production), (error) => error.code === "KAI_PUBLIC_API_GATEWAY_REQUIRED" && error.status === 503);
  assert.doesNotThrow(() => requireKaiPublicApiEnabled({ ...production, KAI_PUBLIC_API_GATEWAY_RATE_LIMITED: "1" }));
});

test("forwarded HTTPS is trusted only when the proxy trust boundary is explicit", () => {
  const request = new Request("http://internal.example.test/api/public/v1/resource-verifications", { headers: { "x-forwarded-proto": "https" } });
  assert.throws(() => requireKaiPublicApiHttps(request, { KAI_ENVIRONMENT: "PRODUCTION" }), (error) => error.code === "HTTPS_REQUIRED");
  assert.doesNotThrow(() => requireKaiPublicApiHttps(request, { KAI_ENVIRONMENT: "PRODUCTION", KAI_TRUST_PROXY: "1" }));
});

test("OAuth Basic is case-insensitive, form-decodes components, and rejects mixed methods", async () => {
  const encodedSecret = encodeURIComponent(clientSecret).replaceAll("%20", "+");
  const authorization = `basic ${Buffer.from(`${clientId}:${encodedSecret}`).toString("base64")}`;
  const parsed = await parseKaiPublicApiTokenRequest(tokenRequest("grant_type=client_credentials&scope=resource%3Aread", authorization), baseEnvironment);
  assert.equal(parsed.client.clientId, clientId);
  await assert.rejects(parseKaiPublicApiTokenRequest(tokenRequest(`grant_type=client_credentials&client_id=${clientId}&client_secret=ignored`, authorization), baseEnvironment), (error) => error.code === "OAUTH_CLIENT_INVALID");
  await assert.rejects(parseKaiPublicApiTokenRequest(tokenRequest("grant_type=client_credentials&grant_type=client_credentials", authorization), baseEnvironment), (error) => error.code === "OAUTH_REQUEST_INVALID");
});

test("Webhook delivery rejects a hostname outside the exact allowlist", async () => {
  const fakeStore = {
    async nextWebhook() { return { deliveryId: "delivery-allowlist", clientId, verificationId: "verification-1", eventVersion: 1, payload: {}, attempt: 0, nextAttemptAt: "2026-08-21T00:00:00.000Z" }; },
    async failWebhook(deliveryId, errorCode, _next, terminal) { this.failure = { deliveryId, errorCode, terminal }; },
  };
  let called = false;
  const result = await deliverOneKaiPublicWebhook({
    store: fakeStore,
    environment: { ...baseEnvironment, KAI_PUBLIC_API_WEBHOOK_ALLOWED_HOSTS: "another.example.test" },
    http: async () => { called = true; return new Response(null, { status: 202 }); },
    now: new Date("2026-08-21T00:00:00.000Z"),
  });
  assert.equal(called, false);
  assert.equal(result.terminal, true);
  assert.deepEqual(fakeStore.failure, { deliveryId: "delivery-allowlist", errorCode: "WEBHOOK_TARGET_REJECTED", terminal: true });
});
