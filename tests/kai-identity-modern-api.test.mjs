import assert from "node:assert/strict";
import test from "node:test";
import { GET as startLogin } from "../app/api/auth/kai/start/route.ts";
import { GET as finishLogin } from "../app/api/auth/kai/callback/route.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { resolveAccountSession } from "../lib/server/account-auth.ts";

const issuer = "https://auth.kai.com";
const discovery = "https://auth.kai.com/.well-known/openid-configuration";
const metadata = {
  issuer,
  authorization_endpoint: "https://auth.kai.com/api/auth/oauth2/authorize",
  token_endpoint: "https://auth.kai.com/api/auth/oauth2/token",
  jwks_uri: "https://auth.kai.com/api/auth/jwks",
  userinfo_endpoint: "https://auth.kai.com/api/auth/oauth2/userinfo",
  id_token_signing_alg_values_supported: ["EdDSA"],
  token_endpoint_auth_methods_supported: ["client_secret_basic"],
};
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function browserFixture(run, options = {}) {
  const settings = {
    NODE_ENV: "production", KAI_TRUST_PROXY: "1", KAI_PUBLIC_ORIGIN: "https://cloud.kai.com",
    KAI_ACCOUNT_OIDC_ISSUER: issuer, KAI_ACCOUNT_OIDC_CLIENT_ID: "cloud-web-integration-2026",
    KAI_ACCOUNT_OIDC_CLIENT_SECRET: "synthetic-client-secret-2026-abcdef",
    KAI_ACCOUNT_OIDC_TRANSACTION_SECRET: "synthetic-transaction-secret-2026-abcdef",
  };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  const oldFetcher = globalThis.fetch;
  const oldStore = globalThis.__kaiAccountAuthStorePromise;
  const store = await createSqliteAccountAuthStore(":memory:");
  Object.assign(process.env, settings);
  globalThis.__kaiAccountAuthStorePromise = Promise.resolve(store);
  let idToken, usedCode = false;
  const calls = [];
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const jwk = { ...await crypto.subtle.exportKey("jwk", keyPair.publicKey), kid: "api-key", alg: "EdDSA", use: "sig" };
  globalThis.fetch = async (url, init = {}) => {
    calls.push(String(url));
    assert.equal(init.redirect, "manual");
    if (String(url) === discovery) return options.discoveryResponse?.() ?? Response.json({ ...metadata, ...options.metadata });
    if (String(url) === metadata.token_endpoint) {
      assert.equal(new Headers(init.headers).get("authorization"), `Basic ${Buffer.from(`${settings.KAI_ACCOUNT_OIDC_CLIENT_ID}:${settings.KAI_ACCOUNT_OIDC_CLIENT_SECRET}`).toString("base64")}`);
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("code"), "api-one-time-code");
      assert.equal(body.get("redirect_uri"), "https://cloud.kai.com/api/auth/kai/callback");
      assert.ok(body.get("code_verifier"));
      if (usedCode) return Response.json({ error: "invalid_grant" }, { status: 400 });
      usedCode = true;
      return Response.json({ token_type: "Bearer", access_token: "api-synthetic-access", id_token: idToken });
    }
    if (String(url) === metadata.jwks_uri) return Response.json({ keys: [jwk] });
    if (String(url) === metadata.userinfo_endpoint) return Response.json({ sub: "api-subject", email: "api@example.test", email_verified: true, name: "API User", ...options.userinfo });
    throw new Error("unexpected identity endpoint");
  };
  try {
    const started = await startLogin(new Request("https://cloud.kai.com/api/auth/kai/start?returnTo=%2Fsupply"));
    if (started.status !== 302) return await run({ started, calls, store });
    const authorization = new URL(started.headers.get("location"));
    assert.equal(`${authorization.origin}${authorization.pathname}`, metadata.authorization_endpoint);
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg: "EdDSA", kid: "api-key" });
    const payload = encode({ iss: issuer, aud: settings.KAI_ACCOUNT_OIDC_CLIENT_ID, sub: "api-subject", nonce: authorization.searchParams.get("nonce"), iat: now, exp: now + 300, ...options.claims });
    const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", keyPair.privateKey, new TextEncoder().encode(`${header}.${payload}`)));
    if (options.corruptSignature) signature[0] ^= 1;
    idToken = `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
    const callback = new URL("https://cloud.kai.com/api/auth/kai/callback");
    callback.search = new URLSearchParams({ code: "api-one-time-code", state: authorization.searchParams.get("state"), iss: issuer, ...options.callback }).toString();
    const request = new Request(callback, { headers: { cookie: started.headers.get("set-cookie").split(";", 1)[0] } });
    await run({ started, request, calls, store });
  } finally {
    globalThis.fetch = oldFetcher;
    globalThis.__kaiAccountAuthStorePromise = oldStore;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    store.close();
  }
}

test("modern browser API uses root discovery, API endpoints, PKCE and an EdDSA-authenticated session", async () => {
  await browserFixture(async ({ started, request, calls, store }) => {
    assert.match(started.headers.get("set-cookie"), /^__Host-kai_oidc_transaction=.*; HttpOnly; SameSite=Lax; Secure$/u);
    const result = await finishLogin(request);
    assert.equal(result.status, 303);
    assert.equal(result.headers.get("location"), "/supply");
    const cookies = result.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.ok(cookies.some((cookie) => cookie.startsWith("__Host-kai_oidc_transaction=;")));
    const sessionCookie = cookies.find((cookie) => !cookie.startsWith("__Host-kai_oidc_transaction="));
    const session = await resolveAccountSession(new Request("https://cloud.kai.com/api/member", { headers: { cookie: sessionCookie.split(";", 1)[0] } }), { store });
    assert.equal(session.authMethod, "KAI_IDENTITY_OIDC");
    assert.equal(session.account.primaryEmail, "api@example.test");
    assert.equal(await store.hasSuccessfulKaiIdentityLoginAudit(), true);
    assert.deepEqual(calls, [discovery, discovery, metadata.token_endpoint, metadata.jwks_uri, metadata.userinfo_endpoint]);
    const replay = await finishLogin(request);
    assert.match(replay.headers.get("location"), /authError=OIDC_TOKEN_EXCHANGE_FAILED/u);
  });
});

test("modern browser API fails closed on signed token, callback and userinfo mismatches", async (t) => {
  for (const [name, options, code] of [
    ["nonce", { claims: { nonce: "wrong" } }, "OIDC_ID_TOKEN_INVALID"],
    ["token issuer", { claims: { iss: "https://auth.kai.com/api/auth" } }, "OIDC_ID_TOKEN_INVALID"],
    ["audience", { claims: { aud: "another-client" } }, "OIDC_ID_TOKEN_INVALID"],
    ["expired", { claims: { exp: 1 } }, "OIDC_ID_TOKEN_INVALID"],
    ["signature", { corruptSignature: true }, "OIDC_ID_TOKEN_INVALID"],
    ["callback issuer", { callback: { iss: "https://auth.kai.com/api/auth" } }, "OIDC_ISSUER_INVALID"],
    ["state", { callback: { state: "wrong" } }, "OIDC_STATE_INVALID"],
    ["userinfo subject", { userinfo: { sub: "another-user" } }, "OIDC_USERINFO_INVALID"],
  ]) await t.test(name, () => browserFixture(async ({ request, store }) => {
    const result = await finishLogin(request);
    assert.equal(result.status, 303);
    assert.equal(new URL(result.headers.get("location"), "https://cloud.kai.com").searchParams.get("authError"), code);
    assert.equal(await store.hasSuccessfulKaiIdentityLoginAudit(), false);
    assert.equal(result.headers.getSetCookie().length, 1);
  }, options));
});

test("modern browser API rejects wrong same-origin paths, old issuer and oversized Discovery", async (t) => {
  for (const [name, options] of [
    ["wrong API prefix", { metadata: { token_endpoint: "https://auth.kai.com/oauth2/token" } }],
    ["old issuer", { metadata: { issuer: "https://auth.kai.com/api/auth" } }],
    ["normalized alias", { metadata: { jwks_uri: "https://auth.kai.com/api/auth/a/../jwks" } }],
    ["missing methods", { metadata: { token_endpoint_auth_methods_supported: undefined } }],
    ["oversized JSON", { discoveryResponse: () => Response.json({ ...metadata, padding: "x".repeat(513 * 1024) }) }],
  ]) await t.test(name, () => browserFixture(async ({ started, calls, store }) => {
    assert.equal(started.status, 303);
    assert.match(started.headers.get("location"), /authError=OIDC_DISCOVERY_INVALID/u);
    assert.deepEqual(calls, [discovery]);
    assert.equal(await store.hasSuccessfulKaiIdentityLoginAudit(), false);
  }, options));
});
