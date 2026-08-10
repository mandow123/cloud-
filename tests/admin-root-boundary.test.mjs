import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AccountAuthError, assertAccountAuthSameOrigin, createAccountSession } from "../lib/server/account-auth.ts";
import { requireAdminPermission } from "../lib/server/admin-auth.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("admin write entry points reject same-site cross-origin requests before any mutation", () => {
  assert.throws(
    () => assertAccountAuthSameOrigin(new Request("https://cloud.kai.com/api/v1/admin/work-items", {
      method: "POST",
      headers: { origin: "https://tenant.kai.com", "sec-fetch-site": "same-site" },
    })),
    (error) => error instanceof AccountAuthError && error.status === 403 && error.code === "AUTH_ORIGIN_REJECTED",
  );

  const shared = source("app/api/v1/admin/_shared.ts");
  const writeBody = shared.slice(shared.indexOf("export async function adminWrite"));
  assert.ok(writeBody.indexOf("assertAccountAuthSameOrigin(request)") < writeBody.indexOf("requireAdminPermission(request"));
  assert.ok(writeBody.indexOf("requireAdminPermission(request") < writeBody.indexOf("getAdminOperationsStore()"));

  const standardization = source("app/api/v1/admin/standardization/snapshots/route.ts");
  const postBody = standardization.slice(standardization.indexOf("export async function POST"));
  assert.ok(postBody.indexOf("assertAccountAuthSameOrigin(request)") < postBody.indexOf("requireAdminPermission(request"));
  assert.ok(postBody.indexOf("requireAdminPermission(request") < postBody.indexOf("getStandardizationStore()"));
});

test("unauthenticated and email-authenticated Root checks fail before backend data access", async () => {
  await assert.rejects(
    requireAdminPermission(new Request("https://cloud.kai.com/api/v1/admin/dashboard"), ["ADMIN_PANEL_READ"]),
    (error) => error instanceof AccountAuthError && error.status === 401,
  );

  const store = await createSqliteAccountAuthStore(":memory:");
  const now = new Date();
  const identityInput = {
    provider: "EMAIL",
    tenantKey: "EXTERNAL",
    subject: "non-root-admin-boundary",
    displayName: "Non Root",
    normalizedEmail: "non-root@example.test",
    organizationExternalKey: "EMAIL:non-root-admin-boundary",
    organizationName: "Non Root Organization",
    verifiedAt: now.toISOString(),
  };
  const identity = await store.resolveOrCreateIdentity(identityInput);
  await store.activateMembership(identity.membership.id, ["ROOT"], now.toISOString());
  const active = await store.resolveOrCreateIdentity(identityInput);
  const issued = await createAccountSession(
    new Request("https://cloud.kai.com/api/auth/email/verify"),
    active,
    "EMAIL_OTP",
    { store, now },
  );
  const previous = globalThis.__kaiAccountAuthStorePromise;
  globalThis.__kaiAccountAuthStorePromise = Promise.resolve(store);
  try {
    const request = new Request("https://cloud.kai.com/api/v1/admin/dashboard", {
      headers: { cookie: issued.cookie.split(";", 1)[0] },
    });
    await assert.rejects(
      requireAdminPermission(request, ["ADMIN_PANEL_READ"]),
      (error) => error instanceof AccountAuthError && error.status === 403 && error.code === "ADMIN_ACCESS_FORBIDDEN",
    );
  } finally {
    globalThis.__kaiAccountAuthStorePromise = previous;
    store.close();
  }

  const shared = source("app/api/v1/admin/_shared.ts");
  const readBody = shared.slice(shared.indexOf("export async function adminRead"), shared.indexOf("export async function adminWrite"));
  assert.ok(readBody.indexOf("requireAdminPermission(request") < readBody.indexOf("getAdminOperationsStore()"));
});

test("administrator UI exposes only the independent password entry point", () => {
  const login = source("components/admin-login.tsx");
  assert.match(login, /\/api\/auth\/admin\/password/u);
  assert.doesNotMatch(login, /飞书|邮箱登录|bootstrap-admin|bootstrapRootAccount/u);
  assert.match(source("app/api/auth/admin/password/route.ts"), /createAdminPasswordSession/u);
});
