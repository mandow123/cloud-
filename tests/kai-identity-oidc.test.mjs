import assert from "node:assert/strict";
import test from "node:test";

import { AccountAuthError, resolveAccountSession } from "../lib/server/account-auth.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { beginKaiIdentityLogin, clearKaiIdentityTransactionCookie, completeKaiIdentityLogin, kaiIdentityTransactionReturnTo, KAI_IDENTITY_DISCOVERY, KAI_IDENTITY_ISSUER, KAI_IDENTITY_MODERN_DISCOVERY, KAI_IDENTITY_MODERN_ISSUER, probeKaiIdentityDiscovery } from "../lib/server/kai-identity-oidc.ts";
import { readFileSync } from "node:fs";

const encoder = new TextEncoder();
const encode = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
function assertProtectedJsonRequest(init) {
  assert.equal(init.redirect, "manual");
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.signal.aborted, false);
}
const validMetadata = () => ({
  issuer: KAI_IDENTITY_ISSUER,
  authorization_endpoint: `${KAI_IDENTITY_ISSUER}/auth`,
  token_endpoint: `${KAI_IDENTITY_ISSUER}/token`,
  jwks_uri: `${KAI_IDENTITY_ISSUER}/jwks`,
  userinfo_endpoint: `${KAI_IDENTITY_ISSUER}/me`,
});

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
  const initialFetcher = async (url, init) => {
    assert.equal(String(url), KAI_IDENTITY_DISCOVERY);
    assert.equal(init.redirect, "manual");
    assert.ok(init.signal instanceof AbortSignal);
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
      assertProtectedJsonRequest(init);
      assert.equal(init.method, "POST");
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("client_id"), env.KAI_ACCOUNT_OIDC_CLIENT_ID);
      assert.equal(body.get("code"), "one-time-code");
      assert.ok(body.get("code_verifier"));
      return Response.json({ access_token: "opaque-access-token", token_type: "Bearer", scope: "openid kai:name email", id_token: idToken });
    }
    if (String(url) === metadata.jwks_uri) {
      assertProtectedJsonRequest(init);
      return Response.json({ keys: [publicJwk] });
    }
    if (String(url) === metadata.userinfo_endpoint) {
      assertProtectedJsonRequest(init);
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

test("modern KAI Identity exchanges a confidential PKCE code and verifies an EdDSA ID token", async () => {
  const now = new Date("2026-08-13T01:30:00.000Z");
  const env = {
    NODE_ENV: "production",
    KAI_TRUST_PROXY: "1",
    KAI_PUBLIC_ORIGIN: "https://cloud.kai.com",
    KAI_ACCOUNT_OIDC_ISSUER: KAI_IDENTITY_MODERN_ISSUER,
    KAI_ACCOUNT_OIDC_CLIENT_ID: "cloud-web-client-2026",
    KAI_ACCOUNT_OIDC_CLIENT_SECRET: "modern-client-secret-0000000000000000",
    KAI_ACCOUNT_OIDC_TRANSACTION_SECRET: "modern-transaction-secret-000000000000000000000000",
  };
  const metadata = {
    issuer: KAI_IDENTITY_MODERN_ISSUER,
    authorization_endpoint: `${KAI_IDENTITY_MODERN_ISSUER}/oauth2/authorize`,
    token_endpoint: `${KAI_IDENTITY_MODERN_ISSUER}/oauth2/token`,
    jwks_uri: `${KAI_IDENTITY_MODERN_ISSUER}/jwks`,
    userinfo_endpoint: `${KAI_IDENTITY_MODERN_ISSUER}/oauth2/userinfo`,
    id_token_signing_alg_values_supported: ["EdDSA"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
  };
  const started = await beginKaiIdentityLogin(new Request("https://cloud.kai.com/api/auth/kai/start?returnTo=%2Fsupply"), {
    env,
    now,
    fetcher: async (url) => {
      assert.equal(String(url), KAI_IDENTITY_MODERN_DISCOVERY);
      return Response.json(metadata);
    },
  });
  const authorization = new URL(started.location);
  const state = authorization.searchParams.get("state");
  const nonce = authorization.searchParams.get("nonce");
  assert.equal(authorization.searchParams.get("scope"), "openid profile email");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");

  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  publicJwk.kid = "modern-key";
  publicJwk.use = "sig";
  publicJwk.alg = "EdDSA";
  const header = encode({ alg: "EdDSA", kid: "modern-key", typ: "JWT" });
  const claims = encode({ iss: KAI_IDENTITY_MODERN_ISSUER, aud: env.KAI_ACCOUNT_OIDC_CLIENT_ID, sub: "modern-cloud-user", nonce, iat: Math.floor(now.getTime() / 1000), exp: Math.floor(now.getTime() / 1000) + 3_600 });
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, encoder.encode(`${header}.${claims}`)));
  const idToken = `${header}.${claims}.${Buffer.from(signature).toString("base64url")}`;
  const fetcher = async (url, init = {}) => {
    if (String(url) === KAI_IDENTITY_MODERN_DISCOVERY) return Response.json(metadata);
    if (String(url) === metadata.token_endpoint) {
      assertProtectedJsonRequest(init);
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), `Basic ${Buffer.from(`${env.KAI_ACCOUNT_OIDC_CLIENT_ID}:${env.KAI_ACCOUNT_OIDC_CLIENT_SECRET}`).toString("base64")}`);
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("client_id"), null);
      assert.equal(body.get("code"), "modern-code");
      assert.ok(body.get("code_verifier"));
      return Response.json({ access_token: "modern-access-token", token_type: "Bearer", id_token: idToken });
    }
    if (String(url) === metadata.jwks_uri) {
      assertProtectedJsonRequest(init);
      return Response.json({ keys: [publicJwk] });
    }
    if (String(url) === metadata.userinfo_endpoint) {
      assertProtectedJsonRequest(init);
      return Response.json({ sub: "modern-cloud-user", name: "Modern User", email: "modern@example.com", email_verified: true });
    }
    throw new Error(`unexpected request ${url}`);
  };
  const store = await createSqliteAccountAuthStore(":memory:");
  const callback = new Request(`https://cloud.kai.com/api/auth/kai/callback?code=modern-code&state=${encodeURIComponent(state)}&iss=${encodeURIComponent(KAI_IDENTITY_MODERN_ISSUER)}`, {
    headers: { cookie: started.transactionCookie.split(";", 1)[0] },
  });
  const completed = await completeKaiIdentityLogin(callback, { env, now, fetcher, store });
  assert.equal(completed.returnTo, "/supply");
  assert.equal(completed.issued.context.account.primaryEmail, "modern@example.com");
  assert.equal(completed.issued.context.authMethod, "KAI_IDENTITY_OIDC");
  store.close();
});

test("token, JWKS and UserInfo requests reject redirects instead of following them", async (t) => {
  const cases = [
    { endpoint: `${KAI_IDENTITY_ISSUER}/token`, code: "OIDC_TOKEN_EXCHANGE_FAILED" },
    { endpoint: `${KAI_IDENTITY_ISSUER}/jwks`, code: "OIDC_JWKS_INVALID" },
    { endpoint: `${KAI_IDENTITY_ISSUER}/me`, code: "OIDC_USERINFO_INVALID" },
  ];
  for (const item of cases) {
    await t.test(item.endpoint, async () => {
      const { env, now, started, state, fetcher } = await fixture();
      const callback = new Request(`http://localhost:3014/api/auth/kai/callback?code=one-time-code&state=${encodeURIComponent(state)}`, {
        headers: { cookie: started.transactionCookie.split(";", 1)[0] },
      });
      const redirectingFetcher = async (url, init = {}) => {
        if (String(url) === item.endpoint) {
          assertProtectedJsonRequest(init);
          return new Response(null, { status: 307, headers: { location: "https://attacker.example/oidc" } });
        }
        return fetcher(url, init);
      };
      const store = await createSqliteAccountAuthStore(":memory:");
      try {
        await assert.rejects(
          completeKaiIdentityLogin(callback, { env, now, fetcher: redirectingFetcher, store }),
          (error) => error instanceof AccountAuthError && error.code === item.code,
        );
      } finally { store.close(); }
    });
  }
});

test("OIDC JSON responses are bounded before parsing", async (t) => {
  const responses = [
    { name: "declared length", response: () => new Response("{}", { headers: { "content-length": String(512 * 1024 + 1), "content-type": "application/json" } }) },
    { name: "streamed body", response: () => new Response(JSON.stringify({ padding: "x".repeat(512 * 1024) }), { headers: { "content-type": "application/json" } }) },
  ];
  for (const item of responses) {
    await t.test(item.name, async () => {
      const { env, now, started, state, fetcher } = await fixture();
      const callback = new Request(`http://localhost:3014/api/auth/kai/callback?code=one-time-code&state=${encodeURIComponent(state)}`, {
        headers: { cookie: started.transactionCookie.split(";", 1)[0] },
      });
      const oversizedFetcher = async (url, init = {}) => {
        if (String(url) === `${KAI_IDENTITY_ISSUER}/token`) {
          assertProtectedJsonRequest(init);
          return item.response();
        }
        return fetcher(url, init);
      };
      const store = await createSqliteAccountAuthStore(":memory:");
      try {
        await assert.rejects(
          completeKaiIdentityLogin(callback, { env, now, fetcher: oversizedFetcher, store }),
          (error) => error instanceof AccountAuthError
            && error.code === "OIDC_TOKEN_EXCHANGE_FAILED"
            && error.message.includes("超过大小限制"),
        );
      } finally { store.close(); }
    });
  }
});

test("ID Token verification rejects JWKs with incompatible use, alg or key_ops", async (t) => {
  const mutations = [
    { name: "use", mutate: (key) => ({ ...key, use: "enc" }) },
    { name: "alg", mutate: (key) => ({ ...key, alg: "ES384" }) },
    { name: "key_ops", mutate: (key) => ({ ...key, key_ops: ["sign"] }) },
  ];
  for (const item of mutations) {
    await t.test(item.name, async () => {
      const { env, now, started, state, fetcher } = await fixture();
      const callback = new Request(`http://localhost:3014/api/auth/kai/callback?code=one-time-code&state=${encodeURIComponent(state)}`, {
        headers: { cookie: started.transactionCookie.split(";", 1)[0] },
      });
      const invalidJwkFetcher = async (url, init = {}) => {
        const response = await fetcher(url, init);
        if (String(url) !== `${KAI_IDENTITY_ISSUER}/jwks`) return response;
        const payload = await response.json();
        return Response.json({ keys: [item.mutate(payload.keys[0])] });
      };
      const store = await createSqliteAccountAuthStore(":memory:");
      try {
        await assert.rejects(
          completeKaiIdentityLogin(callback, { env, now, fetcher: invalidJwkFetcher, store }),
          (error) => error instanceof AccountAuthError && error.code === "OIDC_JWKS_INVALID",
        );
      } finally { store.close(); }
    });
  }
});

test("token exchange requires a Bearer token type", async () => {
  const { env, now, started, state, fetcher } = await fixture();
  const callback = new Request(`http://localhost:3014/api/auth/kai/callback?code=one-time-code&state=${encodeURIComponent(state)}`, {
    headers: { cookie: started.transactionCookie.split(";", 1)[0] },
  });
  const wrongTokenTypeFetcher = async (url, init = {}) => {
    const response = await fetcher(url, init);
    if (String(url) !== `${KAI_IDENTITY_ISSUER}/token`) return response;
    return Response.json({ ...await response.json(), token_type: "MAC" });
  };
  const store = await createSqliteAccountAuthStore(":memory:");
  try {
    await assert.rejects(
      completeKaiIdentityLogin(callback, { env, now, fetcher: wrongTokenTypeFetcher, store }),
      (error) => error instanceof AccountAuthError && error.code === "OIDC_TOKEN_EXCHANGE_FAILED",
    );
  } finally { store.close(); }
});

test("modern KAI Identity rejects cross-origin Discovery endpoints and unapproved issuers", async () => {
  const env = {
    NODE_ENV: "production",
    KAI_PUBLIC_ORIGIN: "https://cloud.kai.com",
    KAI_ACCOUNT_OIDC_ISSUER: KAI_IDENTITY_MODERN_ISSUER,
    KAI_ACCOUNT_OIDC_CLIENT_ID: "cloud-web-client-2026",
    KAI_ACCOUNT_OIDC_CLIENT_SECRET: "modern-client-secret-0000000000000000",
    KAI_ACCOUNT_OIDC_TRANSACTION_SECRET: "modern-transaction-secret-000000000000000000000000",
  };
  const poisoned = {
    issuer: KAI_IDENTITY_MODERN_ISSUER,
    authorization_endpoint: `${KAI_IDENTITY_MODERN_ISSUER}/oauth2/authorize`,
    token_endpoint: "https://attacker.example/token",
    jwks_uri: `${KAI_IDENTITY_MODERN_ISSUER}/jwks`,
    userinfo_endpoint: `${KAI_IDENTITY_MODERN_ISSUER}/oauth2/userinfo`,
    id_token_signing_alg_values_supported: ["EdDSA"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
  };
  await assert.rejects(beginKaiIdentityLogin(new Request("https://cloud.kai.com/api/auth/kai/start"), {
    env,
    fetcher: async () => Response.json(poisoned),
  }), (error) => error instanceof AccountAuthError && error.code === "OIDC_DISCOVERY_INVALID");
  await assert.rejects(beginKaiIdentityLogin(new Request("https://cloud.kai.com/api/auth/kai/start"), {
    env: { ...env, KAI_ACCOUNT_OIDC_ISSUER: "https://attacker.example" },
    fetcher: async () => Response.json(poisoned),
  }), (error) => error instanceof AccountAuthError && error.code === "KAI_IDENTITY_NOT_CONFIGURED");
});

test("KAI Identity readiness validates Discovery without following redirects", async () => {
  const healthy = await probeKaiIdentityDiscovery({ fetcher: async (url, init) => {
    assert.equal(String(url), KAI_IDENTITY_DISCOVERY);
    assert.equal(init?.redirect, "manual");
    return Response.json(validMetadata());
  } });
  assert.deepEqual(healthy, { available: true, probe: "read-only" });

  const redirected = await probeKaiIdentityDiscovery({ fetcher: async () => new Response(null, {
    status: 308,
    headers: { location: KAI_IDENTITY_DISCOVERY },
  }) });
  assert.deepEqual(redirected, { available: false, probe: "read-only", errorCode: "OIDC_DISCOVERY_REDIRECT" });
});

test("KAI Identity login fails closed when Discovery redirects to itself", async () => {
  const env = {
    NODE_ENV: "production",
    KAI_PUBLIC_ORIGIN: "https://cloud.kai.com",
    KAI_ACCOUNT_OIDC_CLIENT_ID: "kaic_cloud_test_123456",
    KAI_ACCOUNT_OIDC_TRANSACTION_SECRET: "oidc-transaction-secret-000000000000000000000000",
  };
  await assert.rejects(beginKaiIdentityLogin(new Request("https://cloud.kai.com/api/auth/kai/start"), {
    env,
    fetcher: async () => new Response(null, { status: 308, headers: { location: KAI_IDENTITY_DISCOVERY } }),
  }), (error) => error instanceof AccountAuthError && error.code === "OIDC_DISCOVERY_REDIRECT" && error.status === 503);
});

test("the browser login entry returns safely to the login page instead of exposing a JSON error", () => {
  const route = readFileSync(new URL("../app/api/auth/kai/start/route.ts", import.meta.url), "utf8");
  assert.match(route, /status:\s*303/u);
  assert.match(route, /new URLSearchParams\(\{ returnTo: safeReturnTo\(request\), authError: code \}\)/u);
  assert.match(route, /clearKaiIdentityTransactionCookie\(request\)/u);
  assert.doesNotMatch(route, /accountAuthErrorResponse/u);
});

test("KAI Identity rejects a callback whose state does not match the sealed transaction", async () => {
  const { env, now, started, fetcher } = await fixture();
  const callback = new Request("http://localhost:3014/api/auth/kai/callback?code=one-time-code&state=wrong", { headers: { cookie: started.transactionCookie.split(";", 1)[0] } });
  assert.equal(await kaiIdentityTransactionReturnTo(callback, { env, now }), "/member?view=wallet");
  await assert.rejects(completeKaiIdentityLogin(callback, { env, now, fetcher }), (error) => error instanceof AccountAuthError && error.code === "OIDC_STATE_INVALID");
});

test("the callback error redirect preserves the sealed safe return target", () => {
  const route = readFileSync(new URL("../app/api/auth/kai/callback/route.ts", import.meta.url), "utf8");
  assert.match(route, /kaiIdentityTransactionReturnTo\(request\)/u);
  assert.match(route, /new URLSearchParams\(\{ returnTo, authError: code \}\)/u);
  assert.match(route, /clearKaiIdentityTransactionCookie\(request\)/u);
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
