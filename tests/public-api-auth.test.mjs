import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { POST as tokenPost } from "../app/api/public/v1/oauth/token/route.ts";
import { authenticateKaiPublicApiRequest, authenticateKaiPublicApiClient, issueKaiPublicApiToken } from "../lib/server/public-api-auth.ts";
import { isKaiPublicApiEnabled, requireKaiPublicApiEnabled } from "../lib/server/public-api-feature.ts";

const secret = "sandbox-client-secret-at-least-32-characters";
const secretSha256 = createHash("sha256").update(secret).digest("hex");
const environment = {
  NODE_ENV: "test",
  KAI_ENVIRONMENT: "SANDBOX",
  KAI_PUBLIC_API_ENABLED: "1",
  KAI_PUBLIC_API_ISSUER: "kai-cloud-sandbox",
  KAI_PUBLIC_API_TOKEN_SIGNING_SECRET: "token-signing-secret-at-least-32-characters",
  KAI_PUBLIC_API_CLIENTS: JSON.stringify([{
    clientId: "zod-sandbox-backend",
    secretSha256,
    organizationId: "org_sandbox_supplier",
    organizationReference: "zod_org_sandbox",
    accountId: "acct_sandbox_service",
    scopes: ["resource:read", "verification:write"],
  }]),
};

test("public API is fail-closed until explicitly enabled", () => {
  assert.equal(isKaiPublicApiEnabled({}), false);
  assert.throws(() => requireKaiPublicApiEnabled({}), (error) => error.code === "KAI_PUBLIC_API_DISABLED" && error.status === 503);
  assert.equal(isKaiPublicApiEnabled(environment), true);
});

test("client credentials are verified from a SHA-256 digest and never returned", async () => {
  const client = await authenticateKaiPublicApiClient("zod-sandbox-backend", secret, environment);
  assert.equal(client.organizationReference, "zod_org_sandbox");
  assert.equal("clientSecret" in client, false);
  await assert.rejects(authenticateKaiPublicApiClient("zod-sandbox-backend", `${secret}-wrong`, environment), (error) => error.code === "OAUTH_CLIENT_INVALID");
});

test("short-lived bearer tokens bind scopes and organization", async () => {
  const client = await authenticateKaiPublicApiClient("zod-sandbox-backend", secret, environment);
  const now = new Date("2026-08-20T06:00:00Z");
  const token = await issueKaiPublicApiToken(client, environment, now);
  const request = new Request("https://sandbox-api.cloud.kai.com/api/public/v1/resource-verifications", { headers: { authorization: `Bearer ${token.accessToken}` } });
  const principal = await authenticateKaiPublicApiRequest(request, ["resource:read"], environment, new Date(now.getTime() + 60_000));
  assert.equal(principal.organizationId, "org_sandbox_supplier");
  await assert.rejects(authenticateKaiPublicApiRequest(request, ["agent:write"], environment, now), (error) => error.code === "OAUTH_SCOPE_INSUFFICIENT" && error.status === 403);
  await assert.rejects(authenticateKaiPublicApiRequest(request, ["resource:read"], environment, new Date(now.getTime() + 301_000)), (error) => error.code === "OAUTH_CLIENT_INVALID");
});

test("token endpoint implements client_credentials without cookies or CSRF", async () => {
  const previous = {};
  for (const [key, value] of Object.entries(environment)) { previous[key] = process.env[key]; process.env[key] = value; }
  try {
    const authorization = Buffer.from(`zod-sandbox-backend:${secret}`).toString("base64");
    const response = await tokenPost(new Request("https://sandbox-auth.cloud.kai.com/api/public/v1/oauth/token", {
      method: "POST",
      headers: { authorization: `Basic ${authorization}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&scope=resource%3Aread",
    }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.token_type, "Bearer");
    assert.equal(payload.expires_in, 300);
    assert.equal(payload.scope, "resource:read");
    assert.equal(response.headers.has("set-cookie"), false);
    assert.doesNotMatch(JSON.stringify(payload), new RegExp(secret, "u"));

    const invalid = await tokenPost(new Request("https://sandbox-auth.cloud.kai.com/api/public/v1/oauth/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=password",
    }));
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "OAUTH_GRANT_UNSUPPORTED");
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
