import assert from "node:assert/strict";
import test from "node:test";

import { AccountAuthError, resolveAccountSession } from "../lib/server/account-auth.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { beginKaiIdentityLogin, clearKaiIdentityTransactionCookie, completeKaiIdentityLogin, KAI_IDENTITY_DISCOVERY, KAI_IDENTITY_ISSUER } from "../lib/server/kai-identity-oidc.ts";

const encoder = new TextEncoder();
const encode = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

async function fixture() {
  const now = new Date("2026-08-10T08:00:00.000Z");
  const env = {
    NODE_ENV: "development",
    KAI_PUBLIC_ORIGIN: "http://localhost:3014",
    KAI_ACCOUNT_OIDC_CLIENT_ID: "kaic_cloud_test_123456",
    KAI_ACCOUNT_OIDC_TRANSACTION_SECRET: "oidc-transaction-secret-000000000000000000000000",
  };
  const metadata = {
    issuer: KAI_IDENTITY_ISSUER,
    authorization_endpoint: `${KAI_IDENTITY_ISSUER}/auth`,
    token_endpoint: `${KAI_IDENTITY_ISSUER}/token`,
    jwks_uri: `${KAI_IDENTITY_ISSUER}/jwks`,
    userinfo_endpoint: `${KAI_IDENTITY_ISSUER}/me`,
  };
  const initialFetcher = async (url) => {
    assert.equal(String(url), KAI_IDENTITY_DISCOVERY);
    return Response.json(metadata);
  };
  const started = await beginKaiIdentityLogin(new Request("http://localhost:3014/api/auth/kai/start?returnTo=%2Fmember%3Fview%3Dwallet"), { env, fetcher: initialFetcher, now });
  const authorization = new URL(started.location);
  const state = authorization.searchParams.get("state");
  const nonce = authorization.searchParams.get("nonce");
  assert.equal(authorization.origin + authorization.pathname, metadata.authorization_endpoint);
  assert.equal(authorization.searchParams.get("client_id"), env.KAI_ACCOUNT_OIDC_CLIENT_ID);
  assert.equal(authorization.searchParams.get("redirect_uri"), "http://localhost:3014/api/auth/kai/callback");
  assert.equal(authorization.searchParams.get("scope"), "openid kai:name email");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.ok(state && nonce && authorization.searchParams.get("code_challenge"));

  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  publicJwk.kid = "test-key";
  publicJwk.use = "sig";
  publicJwk.alg = "ES256";
  const header = encode({ alg: "ES256", kid: "test-key", typ: "JWT" });
  const claims = encode({ iss: KAI_IDENTITY_ISSUER, aud: env.KAI_ACCOUNT_OIDC_CLIENT_ID, sub: "pairwise-cloud-user", nonce, iat: Math.floor(now.getTime() / 1000), exp: Math.floor(now.getTime() / 1000) + 300 });
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, encoder.encode(`${header}.${claims}`)));
  const idToken = `${header}.${claims}.${Buffer.from(signature).toString("base64url")}`;
  const fetcher = async (url, init = {}) => {
    if (String(url) === KAI_IDENTITY_DISCOVERY) return Response.json(metadata);
    if (String(url) === metadata.token_endpoint) {
      assert.equal(init.method, "POST");
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("client_id"), env.KAI_ACCOUNT_OIDC_CLIENT_ID);
      assert.equal(body.get("code"), "one-time-code");
      assert.ok(body.get("code_verifier"));
      return Response.json({ access_token: "opaque-access-token", token_type: "Bearer", scope: "openid kai:name email", id_token: idToken });
    }
    if (String(url) === metadata.jwks_uri) return Response.json({ keys: [publicJwk] });
    if (String(url) === metadata.userinfo_endpoint) {
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer opaque-access-token");
      return Response.json({ sub: "pairwise-cloud-user", name: "KAI Cloud User", email: "USER@EXAMPLE.COM", email_verified: true });
    }
    throw new Error(`unexpected request ${url}`);
  };
  return { env, now, started, state, fetcher };
}

test("KAI Identity uses Authorization Code + PKCE and creates an ordinary active Cloud session", async () => {
  const { env, now, started, state, fetcher } = await fixture();
  const store = await createSqliteAccountAuthStore(":memory:");
  const cookie = started.transactionCookie.split(";", 1)[0];
  const callback = new Request(`http://localhost:3014/api/auth/kai/callback?code=one-time-code&state=${encodeURIComponent(state)}&iss=${encodeURIComponent(KAI_IDENTITY_ISSUER)}`, { headers: { cookie } });
  const completed = await completeKaiIdentityLogin(callback, { env, now, fetcher, store });
  assert.equal(completed.returnTo, "/member?view=wallet");
  assert.equal(completed.issued.context.authMethod, "KAI_IDENTITY_OIDC");
  assert.equal(completed.issued.context.account.primaryEmail, "user@example.com");
  assert.equal(completed.issued.context.membership.status, "ACTIVE");
  assert.deepEqual(completed.issued.context.membership.roles, []);
  const sessionCookie = completed.issued.cookie.split(";", 1)[0];
  const resolved = await resolveAccountSession(new Request("http://localhost:3014/api/auth/session", { headers: { cookie: sessionCookie } }), { store, now });
  assert.equal(resolved?.account.id, completed.issued.context.account.id);
  assert.equal(resolved?.authMethod, "KAI_IDENTITY_OIDC");
  store.close();
});

test("KAI Identity rejects a callback whose state does not match the sealed transaction", async () => {
  const { env, now, started, fetcher } = await fixture();
  const callback = new Request("http://localhost:3014/api/auth/kai/callback?code=one-time-code&state=wrong", { headers: { cookie: started.transactionCookie.split(";", 1)[0] } });
  await assert.rejects(completeKaiIdentityLogin(callback, { env, now, fetcher }), (error) => error instanceof AccountAuthError && error.code === "OIDC_STATE_INVALID");
});

test("production canonical HTTPS origin keeps the OIDC transaction cookie Secure behind a trusted proxy", async () => {
  const env = {
    NODE_ENV: "production",
    KAI_TRUST_PROXY: "1",
    KAI_PUBLIC_ORIGIN: "https://cloud.kai.com",
    KAI_ACCOUNT_OIDC_CLIENT_ID: "kaic_cloud_test_123456",
    KAI_ACCOUNT_OIDC_TRANSACTION_SECRET: "oidc-transaction-secret-000000000000000000000000",
  };
  const fetcher = async () => Response.json({
    issuer: KAI_IDENTITY_ISSUER,
    authorization_endpoint: `${KAI_IDENTITY_ISSUER}/auth`,
    token_endpoint: `${KAI_IDENTITY_ISSUER}/token`,
    jwks_uri: `${KAI_IDENTITY_ISSUER}/jwks`,
    userinfo_endpoint: `${KAI_IDENTITY_ISSUER}/me`,
  });
  const started = await beginKaiIdentityLogin(new Request("http://cloud.kai.com/api/auth/kai/start"), { env, fetcher });
  assert.match(started.transactionCookie, /^__Host-kai_oidc_transaction=/u);
  assert.match(started.transactionCookie, /; Path=\/;/u);
  assert.doesNotMatch(started.transactionCookie, /; Path=\/api\/auth\/kai(?:;|$)/u);
  assert.match(started.transactionCookie, /; Secure$/u);
  const cleared = clearKaiIdentityTransactionCookie(new Request("http://cloud.kai.com/api/auth/kai/callback"), env);
  assert.match(cleared, /^__Host-kai_oidc_transaction=; Path=\/; Max-Age=0;/u);
  assert.match(cleared, /; Secure$/u);
});
