import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GET as openMarketplaceSession } from "../app/api/session/route.ts";
import { GET as listSupplyOffers, POST as submitSupplyOffer } from "../app/api/v1/supply/offers/route.ts";
import { createAccountSession } from "../lib/server/account-auth.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { createSqliteAdminOperationsStore } from "../lib/server/admin-store-sqlite.ts";
import { createSqliteMarketplaceStore } from "../lib/server/marketplace-store-sqlite.ts";
import { createSqliteSupplyStore } from "../lib/server/supply-store-sqlite.ts";

const ORIGIN = "http://localhost:3014";

async function json(response, expectedStatus) {
  const body = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(body));
  return body;
}

async function createSupplierSession(auth, now) {
  const identity = await auth.resolveOrCreateKaiIdentity({
    issuer: "https://auth.kai.com/connect",
    subject: "manual-supplier-subject",
    displayName: "万师傅",
    verifiedEmail: "wan@example.com",
    verifiedAt: now,
  });
  const issued = await createAccountSession(
    new Request(`${ORIGIN}/api/auth/kai/callback`),
    identity,
    "KAI_IDENTITY_OIDC",
    { store: auth, now: new Date(now) },
  );
  const accountCookie = issued.cookie.split(";", 1)[0];
  const sessionResponse = await openMarketplaceSession(new Request(`${ORIGIN}/api/session`, {
    headers: { cookie: accountCookie },
  }));
  const sessionBody = await json(sessionResponse, 200);
  const marketplaceCookie = sessionResponse.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(marketplaceCookie);
  return {
    account: issued.context,
    cookie: `${accountCookie}; ${marketplaceCookie}`,
    csrfToken: sessionBody.session.csrfToken,
  };
}

test("authenticated supplier submission is persisted and visible in the administrator projection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-manual-supply-intake-"));
  const databasePath = join(directory, "kai-cloud.sqlite");
  const previousDirectory = process.env.KAI_DB_DIR;
  const previousAccount = globalThis.__kaiAccountAuthStorePromise;
  const previousMarketplace = globalThis.__kaiMarketplaceStorePromise;
  const previousSupply = globalThis.__kaiSupplyStorePromise;
  const previousAdmin = globalThis.__kaiAdminOperationsStorePromise;
  const previousLegacyWrites = process.env.KAI_ALLOW_LEGACY_ANON_WRITES;
  process.env.KAI_DB_DIR = directory;
  delete process.env.KAI_ALLOW_LEGACY_ANON_WRITES;
  globalThis.__kaiMarketplaceStorePromise = undefined;

  const auth = await createSqliteAccountAuthStore(databasePath);
  const supply = await createSqliteSupplyStore(databasePath);
  const admin = await createSqliteAdminOperationsStore(databasePath);
  const marketplace = createSqliteMarketplaceStore();
  globalThis.__kaiAccountAuthStorePromise = Promise.resolve(auth);
  globalThis.__kaiMarketplaceStorePromise = Promise.resolve(marketplace);
  globalThis.__kaiSupplyStorePromise = Promise.resolve(supply);
  globalThis.__kaiAdminOperationsStorePromise = Promise.resolve(admin);

  try {
    const now = new Date().toISOString();
    const session = await createSupplierSession(auth, now);
    const idempotencyKey = "manual-h100-listing-20260819";
    const payload = {
      supplierType: "INDIVIDUAL",
      resourceType: "GPU_SERVER",
      quantity: 1,
      quantityUnit: "NODE",
      pricingUnit: "NODE_HOUR",
      productName: "8×NVIDIA H100 SXM5 服务器",
      specification: "8×H100 98GB、2TB DDR5、7TB 数据盘、Ubuntu 22.04",
      region: "华东",
      deliveryForm: "专线 / VPN",
      availabilityStartAt: null,
      availabilityEndAt: null,
      notes: "人工联系确认网络与档期；当前不安装 Agent、不自动验真或交付。",
    };
    const request = new Request(`${ORIGIN}/api/v1/supply/offers`, {
      method: "POST",
      headers: {
        cookie: session.cookie,
        origin: ORIGIN,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "x-kai-csrf": session.csrfToken,
        "x-kai-workspace-role": "supplier",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    const submitted = await json(await submitSupplyOffer(request), 201);
    assert.equal(submitted.record.status, "SUBMITTED");
    assert.equal(submitted.record.productName, payload.productName);

    const stored = await supply.listOffers(session.account.activeOrganization.id);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.specification, payload.specification);

    const ownRecords = await json(await listSupplyOffers(new Request(`${ORIGIN}/api/v1/supply/offers`, {
      headers: { cookie: session.cookie, "x-kai-workspace-role": "supplier" },
    })), 200);
    assert.equal(ownRecords.count, 1);
    assert.equal(ownRecords.items[0]?.id, submitted.record.id);

    const projected = await admin.readProjection("supply-offers");
    assert.equal(projected.length, 1);
    assert.equal(projected[0]?.id, submitted.record.id);
    assert.equal(projected[0]?.ownership.classification, "BOUND");
    assert.equal(projected[0]?.ownership.accountId, session.account.account.id);
    assert.equal(projected[0]?.ownership.organizationId, session.account.activeOrganization.id);
    assert.equal(projected[0]?.facts.accountDisplayName, "万师傅");
    assert.equal(projected[0]?.facts.accountPrimaryEmail, "wan@example.com");
    assert.equal(projected[0]?.facts.organizationName, session.account.activeOrganization.name);
    assert.equal(projected[0]?.facts.specification, payload.specification);
    assert.equal(projected[0]?.facts.notes, "人工联系确认网络与档期;当前不安装 Agent、不自动验真或交付。");
  } finally {
    auth.close();
    admin.close();
    marketplace.close();
    globalThis.__kaiAccountAuthStorePromise = previousAccount;
    globalThis.__kaiMarketplaceStorePromise = previousMarketplace;
    globalThis.__kaiSupplyStorePromise = previousSupply;
    globalThis.__kaiAdminOperationsStorePromise = previousAdmin;
    if (previousDirectory === undefined) delete process.env.KAI_DB_DIR;
    else process.env.KAI_DB_DIR = previousDirectory;
    if (previousLegacyWrites === undefined) delete process.env.KAI_ALLOW_LEGACY_ANON_WRITES;
    else process.env.KAI_ALLOW_LEGACY_ANON_WRITES = previousLegacyWrites;
    rmSync(directory, { recursive: true, force: true });
  }
});
