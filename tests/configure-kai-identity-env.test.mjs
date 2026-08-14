import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MODERN_IDENTITY_ISSUER,
  configureKaiIdentityEnvironment,
  parseIdentityClientCredentials,
  renderModernIdentityEnvironment,
} from "../scripts/ops/configure-kai-identity-env.mjs";

const credentials = Object.freeze({ clientId: "kaic_cloud_web_2026", clientSecret: "modern-secret-base64url_2026" });

function discovery() {
  return new Response(JSON.stringify({
    issuer: MODERN_IDENTITY_ISSUER,
    authorization_endpoint: `${MODERN_IDENTITY_ISSUER}/oauth2/authorize`,
    token_endpoint: `${MODERN_IDENTITY_ISSUER}/oauth2/token`,
    jwks_uri: `${MODERN_IDENTITY_ISSUER}/jwks`,
    userinfo_endpoint: `${MODERN_IDENTITY_ISSUER}/oauth2/userinfo`,
    token_endpoint_auth_methods_supported: ["client_secret_basic", "private_key_jwt"],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("Identity credential input is exact and never accepts shell syntax", () => {
  assert.deepEqual(parseIdentityClientCredentials(JSON.stringify(credentials)), credentials);
  assert.throws(() => parseIdentityClientCredentials(JSON.stringify({ ...credentials, extra: "value" })), /only clientId and clientSecret/u);
  assert.throws(() => parseIdentityClientCredentials(JSON.stringify({ ...credentials, clientSecret: "unsafe secret" })), /invalid Client Secret/u);
});

test("modern Identity environment replaces legacy values exactly once", () => {
  const rendered = renderModernIdentityEnvironment("KAI_PUBLIC_ORIGIN=https://cloud.kai.com\nKAI_ACCOUNT_OIDC_CLIENT_ID=old\nKAI_ACCOUNT_OIDC_CLIENT_SECRET=old-secret-value\nKAI_ACCOUNT_OIDC_ISSUER=\nKAI_ACCOUNT_OIDC_SCOPES=\n", credentials);
  assert.match(rendered, new RegExp(`^KAI_ACCOUNT_OIDC_ISSUER=${MODERN_IDENTITY_ISSUER}$`, "mu"));
  assert.match(rendered, /^KAI_ACCOUNT_OIDC_SCOPES='openid profile email'$/mu);
  assert.match(rendered, /^KAI_ACCOUNT_OIDC_CLIENT_ID=kaic_cloud_web_2026$/mu);
  assert.match(rendered, /^KAI_ACCOUNT_OIDC_CLIENT_SECRET=modern-secret-base64url_2026$/mu);
  assert.equal((rendered.match(/^KAI_ACCOUNT_OIDC_CLIENT_SECRET=/gmu) ?? []).length, 1);
});

test("configuration validates Discovery, preserves a rollback file and never returns the secret", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-identity-config-"));
  const envFile = join(directory, "kai-cloud-app.env");
  const credentialFile = join(directory, "identity.json");
  await writeFile(envFile, "KAI_PUBLIC_ORIGIN=https://cloud.kai.com\nKAI_ACCOUNT_OIDC_ISSUER=\n", { mode: 0o600 });
  await writeFile(credentialFile, JSON.stringify(credentials), { mode: 0o600 });
  await chmod(credentialFile, 0o600);
  const result = await configureKaiIdentityEnvironment({ envFile, credentialFile, fetcher: async () => discovery(), now: new Date("2026-08-14T09:00:00.000Z"), requireRootOwner: false });
  assert.equal(result.status, "configured");
  assert.equal(result.backupFile, `${envFile}.pre-identity-20260814T090000Z`);
  assert.equal(await readFile(result.backupFile, "utf8"), "KAI_PUBLIC_ORIGIN=https://cloud.kai.com\nKAI_ACCOUNT_OIDC_ISSUER=\n");
  assert.match(await readFile(envFile, "utf8"), /^KAI_ACCOUNT_OIDC_ISSUER=https:\/\/auth\.kai\.com\/api\/auth$/mu);
  assert.equal((await stat(envFile)).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(result), /modern-secret-base64url/u);
});
