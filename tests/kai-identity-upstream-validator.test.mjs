import assert from "node:assert/strict";
import test from "node:test";

import {
  KAI_IDENTITY_DISCOVERY,
  KAI_IDENTITY_ISSUER,
  validateKaiIdentityUpstream,
} from "../scripts/ops/validate-kai-identity-upstream.mjs";

const metadata = () => ({
  issuer: KAI_IDENTITY_ISSUER,
  authorization_endpoint: `${KAI_IDENTITY_ISSUER}/auth`,
  token_endpoint: `${KAI_IDENTITY_ISSUER}/token`,
  jwks_uri: `${KAI_IDENTITY_ISSUER}/jwks`,
  userinfo_endpoint: `${KAI_IDENTITY_ISSUER}/me`,
});

test("Identity upstream validator accepts only exact Cloud OIDC metadata", async () => {
  const result = await validateKaiIdentityUpstream({ fetcher: async (url, init) => {
    assert.equal(String(url), KAI_IDENTITY_DISCOVERY);
    assert.equal(init.redirect, "manual");
    assert.equal(init.headers.accept, "application/json");
    return Response.json(metadata());
  } });
  assert.equal(result.status, "ok");
  assert.equal(result.code, "OIDC_DISCOVERY_READY");
});

test("Identity upstream validator identifies the production self-redirect failure", async () => {
  const result = await validateKaiIdentityUpstream({ fetcher: async () => new Response(null, {
    status: 308,
    headers: { location: KAI_IDENTITY_DISCOVERY },
  }) });
  assert.equal(result.status, "error");
  assert.equal(result.code, "OIDC_DISCOVERY_SELF_REDIRECT");
  assert.equal(result.location, KAI_IDENTITY_DISCOVERY);
});

test("Identity upstream validator reports exact mismatched fields without credentials", async () => {
  const result = await validateKaiIdentityUpstream({ fetcher: async () => Response.json({
    ...metadata(),
    issuer: "https://account.kai.com/incorrect",
    token_endpoint: "https://account.kai.com/token",
  }) });
  assert.equal(result.status, "error");
  assert.equal(result.code, "OIDC_DISCOVERY_METADATA_MISMATCH");
  assert.deepEqual(result.mismatches.map((item) => item.field), ["issuer", "token_endpoint"]);
});
