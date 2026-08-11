import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAccountSession } from "../lib/server/account-auth.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { createSqliteCardHourStore } from "../lib/server/card-hour-store-sqlite.ts";
import { createSqliteMarketplaceStore } from "../lib/server/marketplace-store-sqlite.ts";

import { GET as openMarketplaceSession } from "../app/api/session/route.ts";
import { GET as listTrialGrants, POST as requestTrialGrant } from "../app/api/v2/admin/card-hours/trial-grants/route.ts";
import { POST as decideTrialGrant } from "../app/api/v2/admin/card-hours/trial-grants/[grantId]/decision/route.ts";

const ORIGIN = "http://localhost:3014";

async function json(response, expectedStatus) {
  const body = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(body));
  return body;
}

async function adminBrowser(auth, username, role, now) {
  const identity = await auth.resolveOrCreatePasswordAdministrator({ username, displayName: username, createdAt: now });
  await auth.activateMembership(identity.membership.id, [role], now);
  const active = await auth.resolveOrCreatePasswordAdministrator({ username, displayName: username, createdAt: now });
  const issued = await createAccountSession(new Request(`${ORIGIN}/api/auth/admin/password`), active, "ADMIN_PASSWORD", { store: auth, now: new Date(now) });
  const accountCookie = issued.cookie.split(";", 1)[0];
  const sessionResponse = await openMarketplaceSession(new Request(`${ORIGIN}/api/session`, { headers: { cookie: accountCookie } }));
  const sessionBody = await json(sessionResponse, 200);
  const marketplaceCookie = sessionResponse.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(marketplaceCookie);
  return { cookie: `${accountCookie}; ${marketplaceCookie}`, csrfToken: sessionBody.session.csrfToken, accountId: active.account.id };
}

function write(browser, path, payload, key) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      cookie: browser.cookie,
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-kai-csrf": browser.csrfToken,
      "Idempotency-Key": key,
    },
    body: JSON.stringify(payload),
  });
}

test("Root request and independent finance approval are both required before trial card-hours enter the ledger", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-admin-"));
  const databasePath = join(directory, "kai-cloud.sqlite");
  const previousDirectory = process.env.KAI_DB_DIR;
  const previousOrigin = process.env.KAI_PUBLIC_ORIGIN;
  const previousAccount = globalThis.__kaiAccountAuthStorePromise;
  const previousCardHours = globalThis.__kaiCardHourStorePromise;
  const previousMarketplace = globalThis.__kaiMarketplaceStorePromise;
  process.env.KAI_DB_DIR = directory;
  process.env.KAI_PUBLIC_ORIGIN = ORIGIN;
  const auth = await createSqliteAccountAuthStore(databasePath);
  const cardHours = await createSqliteCardHourStore(databasePath);
  const marketplace = createSqliteMarketplaceStore();
  globalThis.__kaiAccountAuthStorePromise = Promise.resolve(auth);
  globalThis.__kaiCardHourStorePromise = Promise.resolve(cardHours);
  globalThis.__kaiMarketplaceStorePromise = Promise.resolve(marketplace);
  try {
    const now = new Date().toISOString();
    const target = await auth.resolveOrCreateKaiIdentity({
      issuer: "https://account.kai.com/connect",
      subject: "trial-grant-target",
      displayName: "试运营买方",
      verifiedEmail: "trial-grant-target@example.com",
      verifiedAt: now,
    });
    const root = await adminBrowser(auth, "kai-root", "ROOT", now);
    const approver = await adminBrowser(auth, "kai-finance-approver", "FINANCE_APPROVER", now);

    const forged = await json(await requestTrialGrant(write(root, "/api/v2/admin/card-hours/trial-grants", {
      organizationId: target.organization.id,
      cardHours: 12,
      reason: "4090 三分钟黄金闭环测试",
      requestedBy: "forged-actor",
    }, "admin-grant-forged-field")), 400);
    assert.equal(forged.error.code, "CARD_HOUR_ADMIN_FIELD_FORBIDDEN");

    const requested = await json(await requestTrialGrant(write(root, "/api/v2/admin/card-hours/trial-grants", {
      organizationId: target.organization.id,
      cardHours: 12,
      reason: "4090 三分钟黄金闭环测试",
    }, "admin-grant-request-0001")), 201);
    assert.equal(requested.record.status, "REQUESTED");
    assert.equal(requested.record.requestedBy, root.accountId);
    assert.equal(requested.record.approvedBy, null);
    assert.equal((await cardHours.dashboard(target.organization.id, now)).balance.availableMicros, 0);

    const rootCannotApprove = await json(await decideTrialGrant(write(root, `/api/v2/admin/card-hours/trial-grants/${requested.record.id}/decision`, { decision: "APPROVE" }, "admin-grant-root-denied"), { params: Promise.resolve({ grantId: requested.record.id }) }), 403);
    assert.equal(rootCannotApprove.error.code, "CARD_HOUR_GRANT_APPROVER_ROLE_REQUIRED");

    const approverCannotRequest = await json(await requestTrialGrant(write(approver, "/api/v2/admin/card-hours/trial-grants", {
      organizationId: target.organization.id,
      cardHours: 5,
      reason: "审批人不得自行发起卡时申请",
    }, "admin-grant-approver-denied")), 403);
    assert.equal(approverCannotRequest.error.code, "CARD_HOUR_GRANT_REQUEST_ROLE_REQUIRED");

    const approved = await json(await decideTrialGrant(write(approver, `/api/v2/admin/card-hours/trial-grants/${requested.record.id}/decision`, { decision: "APPROVE" }, "admin-grant-approve-0001"), { params: Promise.resolve({ grantId: requested.record.id }) }), 200);
    assert.equal(approved.record.status, "POSTED");
    assert.equal(approved.record.approvedBy, approver.accountId);
    const dashboard = await cardHours.dashboard(target.organization.id, new Date().toISOString());
    assert.equal(dashboard.balance.availableMicros, 12_000_000);
    assert.equal(dashboard.balance.lifetimeTopupMicros, 12_000_000);

    const list = await json(await listTrialGrants(new Request(`${ORIGIN}/api/v2/admin/card-hours/trial-grants`, { headers: { cookie: approver.cookie } })), 200);
    assert.equal(list.records.length, 1);
    assert.equal(list.records[0].status, "POSTED");
  } finally {
    auth.close();
    cardHours.close();
    marketplace.close?.();
    globalThis.__kaiAccountAuthStorePromise = previousAccount;
    globalThis.__kaiCardHourStorePromise = previousCardHours;
    globalThis.__kaiMarketplaceStorePromise = previousMarketplace;
    if (previousDirectory === undefined) delete process.env.KAI_DB_DIR; else process.env.KAI_DB_DIR = previousDirectory;
    if (previousOrigin === undefined) delete process.env.KAI_PUBLIC_ORIGIN; else process.env.KAI_PUBLIC_ORIGIN = previousOrigin;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the Hosting admin page is wired to live approval APIs and has no fake client-side ledger", () => {
  const component = readFileSync(new URL("../components/admin-hosting-operations.tsx", import.meta.url), "utf8");
  const navigation = readFileSync(new URL("../lib/admin-view-models.ts", import.meta.url), "utf8");
  assert.match(component, /\/api\/v2\/admin\/supply\/profiles/u);
  assert.match(component, /\/api\/v2\/admin\/hosting\/fees/u);
  assert.match(component, /\/api\/v2\/admin\/card-hours\/trial-grants/u);
  assert.match(component, /FINANCE_APPROVER/u);
  assert.doesNotMatch(component, /localStorage|sessionStorage/u);
  assert.match(navigation, /href: "\/admin\/hosting"/u);
});
