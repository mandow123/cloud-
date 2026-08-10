import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AccountAuthError, createAccountSession } from "../lib/server/account-auth.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { requireTradingAccountSession } from "../lib/server/entity-ownership.ts";

test("new demands, supply offers and orders require the formal trading account guard", () => {
  const guardedRoutes = [
    "app/api/requests/route.ts",
    "app/api/v1/catalog-purchase-intents/route.ts",
    "app/api/v1/supply/offers/route.ts",
    "app/api/v1/checkouts/route.ts",
    "app/api/v1/supply/trial-orders/route.ts",
  ];
  for (const route of guardedRoutes) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /requireTradingAccountSession\(request\)/u, `${route} must require a formal account`);
  }
  const guard = readFileSync("lib/server/entity-ownership.ts", "utf8");
  assert.match(guard, /await requireAccountSession\(request\)/u);
  assert.match(guard, /membership\.status !== "ACTIVE"/u);
  assert.doesNotMatch(guard, /x-kai-workspace-role/u);
});

test("pending memberships cannot create trading records", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  const now = new Date();
  const identity = await store.resolveOrCreateIdentity({
    provider: "EMAIL",
    tenantKey: "EXTERNAL",
    subject: "pending-trader",
    displayName: "Pending Trader",
    normalizedEmail: "pending@example.com",
    organizationExternalKey: "EMAIL:pending-trader",
    organizationName: "Pending Organization",
    verifiedAt: now.toISOString(),
  });
  const issued = await createAccountSession(new Request("http://localhost/api/auth/email/verify"), identity, "EMAIL_OTP", { store, now });
  const previous = globalThis.__kaiAccountAuthStorePromise;
  const previousLegacyGuard = process.env.KAI_ALLOW_LEGACY_ANON_WRITES;
  globalThis.__kaiAccountAuthStorePromise = Promise.resolve(store);
  delete process.env.KAI_ALLOW_LEGACY_ANON_WRITES;
  try {
    const request = new Request("http://localhost/api/v1/catalog-purchase-intents", { headers: { cookie: issued.cookie.split(";")[0] } });
    await assert.rejects(
      requireTradingAccountSession(request),
      (error) => error instanceof AccountAuthError && error.status === 403 && error.code === "TRADING_SUBJECT_INACTIVE",
    );
  } finally {
    globalThis.__kaiAccountAuthStorePromise = previous;
    if (previousLegacyGuard === undefined) delete process.env.KAI_ALLOW_LEGACY_ANON_WRITES;
    else process.env.KAI_ALLOW_LEGACY_ANON_WRITES = previousLegacyGuard;
    store.close();
  }
});
