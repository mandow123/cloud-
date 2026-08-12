import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createAccountSession } from "../lib/server/account-auth.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { createSqliteCardHourStore } from "../lib/server/card-hour-store-sqlite.ts";
import { createSqliteMarketplaceStore } from "../lib/server/marketplace-store-sqlite.ts";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "../lib/server/marketplace-auth.ts";
import { getHostingV2Store } from "../lib/server/hosting-v2-store.ts";

import { GET as openMarketplaceSession } from "../app/api/session/route.ts";
import { GET as listTrialGrants, POST as requestTrialGrant } from "../app/api/v2/admin/card-hours/trial-grants/route.ts";
import { POST as decideTrialGrant } from "../app/api/v2/admin/card-hours/trial-grants/[grantId]/decision/route.ts";
import { GET as listCleanupIncidents } from "../app/api/v2/admin/hosting/cleanup-incidents/route.ts";
import { POST as retryCleanupIncident } from "../app/api/v2/admin/hosting/cleanup-incidents/[contractId]/retry/route.ts";

const ORIGIN = "http://localhost:3014";

async function json(response, expectedStatus) {
  const body = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(body));
  return body;
}

async function adminBrowser(auth, username, role, now, marketplaceToken) {
  const identity = await auth.resolveOrCreatePasswordAdministrator({ username, displayName: username, createdAt: now });
  await auth.activateMembership(identity.membership.id, [role], now);
  const active = await auth.resolveOrCreatePasswordAdministrator({ username, displayName: username, createdAt: now });
  const issued = await createAccountSession(new Request(`${ORIGIN}/api/auth/admin/password`), active, "ADMIN_PASSWORD", { store: auth, now: new Date(now) });
  const accountCookie = issued.cookie.split(";", 1)[0];
  const existingMarketplaceCookie = marketplaceToken ? `kai_session_dev=${marketplaceToken}` : null;
  const sessionResponse = await openMarketplaceSession(new Request(`${ORIGIN}/api/session`, {
    headers: { cookie: [accountCookie, existingMarketplaceCookie].filter(Boolean).join("; ") },
  }));
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

function seedCleanupIncident(databasePath, now) {
  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  const deviceId = `had_${"a".repeat(32)}`;
  const offerId = `hofr_${"b".repeat(32)}`;
  const contractId = `hctr_${"c".repeat(32)}`;
  const commandId = `hcmd_${"d".repeat(32)}`;
  const feeId = `hfee_${"e".repeat(32)}`;
  const inventory = { hostnameDigest: `sha256:${"1".repeat(64)}`, gpuModel: "RTX_4090", gpuUuidDigest: `sha256:${"2".repeat(64)}`, gpuMemoryMiB: 24_576, driverVersion: "580.10", cudaVersion: "13.0", cpuModel: "AMD Ryzen 9", memoryMiB: 65_536, storageGiB: 2_048, publicHost: "cleanup.example.com", sshPortStart: 27000, sshPortEnd: 27019 };
  db.prepare("INSERT INTO hosting_v2_fee_schedules(id,platform_fee_bps,referral_reward_bps,status,effective_from,created_by,created_at) VALUES(?,1000,300,'ACTIVE',?,'seed',?)").run(feeId, now, now);
  db.prepare(`INSERT INTO hosting_v2_devices(id,organization_id,account_id,display_name,device_key_id,device_public_key,agent_version,inventory_json,inventory_digest,status,verification_status,verification_evidence_digest,verified_until,last_sequence,last_seen_at,version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,'DRAINING','PASSED',?,?,1,?,2,?,?)`).run(deviceId, "org-cleanup-supplier", "acct-cleanup-supplier", "隔离中的 RTX 4090", `sha256:${"3".repeat(64)}`, "A".repeat(43), "1.3.0", JSON.stringify(inventory), `sha256:${"4".repeat(64)}`, `sha256:${"5".repeat(64)}`, new Date(Date.parse(now) + 86_400_000).toISOString(), now, now, now);
  db.prepare(`INSERT INTO hosting_v2_offers(id,organization_id,device_id,fee_schedule_id,title,gpu_model,region,card_hour_micros_per_gpu_hour,min_rental_seconds,max_rental_seconds,available_from,available_until,approved_image,terms_version,status,version,created_at,updated_at)
    VALUES(?,?,?,?,?,'RTX_4090','中国·北京',3600000,180,3600,?,?,?,'KAI_HOSTING_TERMS_2026_08','SUSPENDED',3,?,?)`).run(offerId, "org-cleanup-supplier", deviceId, feeId, "隔离中的 RTX 4090", new Date(Date.parse(now) - 60_000).toISOString(), new Date(Date.parse(now) + 86_400_000).toISOString(), process.env.KAI_HOSTING_APPROVED_IMAGES, now, now);
  const snapshot = { title: "隔离中的 RTX 4090", gpuModel: "RTX_4090", region: "中国·北京", cardHourMicrosPerGpuHour: 3_600_000, approvedImage: process.env.KAI_HOSTING_APPROVED_IMAGES, termsVersion: "KAI_HOSTING_TERMS_2026_08", platformFeeBps: 1_000, referralRewardBps: 300 };
  db.prepare(`INSERT INTO hosting_v2_contracts(id,offer_id,device_id,buyer_organization_id,buyer_account_id,supplier_organization_id,fee_schedule_id,snapshot_json,reserved_seconds,measured_seconds,held_micros,settled_micros,supplier_income_micros,commission_micros,status,idempotency_key,payload_hash,version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,3600,600,3600000,600000,540000,0,'CLEANING','seed-cleanup-contract','seed-cleanup-contract-hash',6,?,?)`).run(contractId, offerId, deviceId, "org-cleanup-buyer", "acct-cleanup-buyer", "org-cleanup-supplier", feeId, JSON.stringify(snapshot), now, now);
  db.prepare("INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,evidence_digest,error_code,created_at,delivered_at,completed_at) VALUES(?,?,?,'CLEANUP',?,'FAILED',1,?,?,?, ?,?)").run(commandId, deviceId, contractId, JSON.stringify({ contractId, removeAuthorizedKeys: true, removeContainer: true, removeWorkspace: true }), `sha256:${"6".repeat(64)}`, "WORKSPACE_DELETE_FAILED", now, now, now);
  db.close();
  return { contractId, deviceId, commandId };
}

test("Root request and independent finance approval are both required before trial card-hours enter the ledger", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-admin-"));
  const databasePath = join(directory, "kai-cloud.sqlite");
  const previousDirectory = process.env.KAI_DB_DIR;
  const previousOrigin = process.env.KAI_PUBLIC_ORIGIN;
  const previousAccount = globalThis.__kaiAccountAuthStorePromise;
  const previousCardHours = globalThis.__kaiCardHourStorePromise;
  const previousMarketplace = globalThis.__kaiMarketplaceStorePromise;
  const previousHostingFlag = process.env.KAI_HOSTING_V2;
  process.env.KAI_DB_DIR = directory;
  process.env.KAI_PUBLIC_ORIGIN = ORIGIN;
  process.env.KAI_HOSTING_V2 = "1";
  const auth = await createSqliteAccountAuthStore(databasePath);
  const cardHours = await createSqliteCardHourStore(databasePath);
  const marketplace = createSqliteMarketplaceStore();
  const hosting = await getHostingV2Store();
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
    const sharedMarketplaceToken = "a".repeat(64);
    const targetSession = await createAccountSession(new Request(`${ORIGIN}/api/auth/kai/callback`), target, "LARK_OAUTH", { store: auth, now: new Date(now) });
    const targetAuthorization = await authorizeMarketplaceRequest(new Request(`${ORIGIN}/api/v2/supply/profile`, {
      headers: { cookie: `${targetSession.cookie.split(";", 1)[0]}; kai_session_dev=${sharedMarketplaceToken}` },
    }));
    await persistMarketplaceSession(targetAuthorization);
    // Account switching must not require a new browser CSRF cookie. This is the
    // same sequence used when a supplier signs out and a Root administrator
    // signs in from the same browser.
    const root = await adminBrowser(auth, "kai-root", "ROOT", now, sharedMarketplaceToken);
    const approver = await adminBrowser(auth, "kai-finance-approver", "FINANCE_APPROVER", now, sharedMarketplaceToken);
    const rootSecondBrowser = await adminBrowser(auth, "kai-root", "ROOT", now, "b".repeat(64));
    assert.equal(root.csrfToken, approver.csrfToken);
    assert.notEqual(root.csrfToken, rootSecondBrowser.csrfToken);

    const forged = await json(await requestTrialGrant(write(root, "/api/v2/admin/card-hours/trial-grants", {
      organizationId: target.organization.id,
      cardHours: 12,
      reason: "4090 三分钟黄金闭环测试",
      requestedBy: "forged-actor",
    }, "admin-grant-forged-field")), 400);
    assert.equal(forged.error.code, "CARD_HOUR_ADMIN_FIELD_FORBIDDEN");
    const secondBrowserForged = await json(await requestTrialGrant(write(rootSecondBrowser, "/api/v2/admin/card-hours/trial-grants", {
      organizationId: target.organization.id,
      cardHours: 12,
      reason: "第二浏览器会话隔离验证",
      requestedBy: "forged-actor",
    }, "admin-grant-second-browser-forged")), 400);
    assert.equal(secondBrowserForged.error.code, "CARD_HOUR_ADMIN_FIELD_FORBIDDEN");

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
    const sessionRows = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(sessionRows.prepare("SELECT COUNT(*) AS count FROM marketplace_sessions_v2").get().count, 3);
    } finally {
      sessionRows.close();
    }
    const dashboard = await cardHours.dashboard(target.organization.id, new Date().toISOString());
    assert.equal(dashboard.balance.availableMicros, 12_000_000);
    assert.equal(dashboard.balance.lifetimeTopupMicros, 12_000_000);

    const list = await json(await listTrialGrants(new Request(`${ORIGIN}/api/v2/admin/card-hours/trial-grants`, { headers: { cookie: approver.cookie } })), 200);
    assert.equal(list.records.length, 1);
    assert.equal(list.records[0].status, "POSTED");

    const cleanupSeed = seedCleanupIncident(databasePath, now);
    const cleanupList = await json(await listCleanupIncidents(new Request(`${ORIGIN}/api/v2/admin/hosting/cleanup-incidents`, { headers: { cookie: root.cookie } })), 200);
    assert.equal(cleanupList.records.length, 1);
    assert.equal(cleanupList.records[0].cleanupCommandStatus, "FAILED");
    const financeCannotRecover = await json(await listCleanupIncidents(new Request(`${ORIGIN}/api/v2/admin/hosting/cleanup-incidents`, { headers: { cookie: approver.cookie } })), 403);
    assert.equal(financeCannotRecover.error.code, "ADMIN_ACCESS_FORBIDDEN");
    const retried = await json(await retryCleanupIncident(write(root, `/api/v2/admin/hosting/cleanup-incidents/${cleanupSeed.contractId}/retry`, {
      expectedContractVersion: 6,
      expectedDeviceVersion: 2,
      reason: "Agent 已恢复在线并完成工作目录故障排查",
    }, "admin-cleanup-retry-0001"), { params: Promise.resolve({ contractId: cleanupSeed.contractId }) }), 202);
    assert.equal(retried.record.status, "PENDING");
    assert.equal(retried.contract.status, "CLEANING");
    assert.equal(retried.device.status, "DRAINING");
    assert.notEqual(retried.record.id, cleanupSeed.commandId);
    const recoveryList = await json(await listCleanupIncidents(new Request(`${ORIGIN}/api/v2/admin/hosting/cleanup-incidents`, { headers: { cookie: root.cookie } })), 200);
    assert.equal(recoveryList.records[0].cleanupCommandStatus, "PENDING");
  } finally {
    auth.close();
    cardHours.close();
    marketplace.close?.();
    hosting.close?.();
    globalThis.__kaiAccountAuthStorePromise = previousAccount;
    globalThis.__kaiCardHourStorePromise = previousCardHours;
    globalThis.__kaiMarketplaceStorePromise = previousMarketplace;
    if (previousDirectory === undefined) delete process.env.KAI_DB_DIR; else process.env.KAI_DB_DIR = previousDirectory;
    if (previousOrigin === undefined) delete process.env.KAI_PUBLIC_ORIGIN; else process.env.KAI_PUBLIC_ORIGIN = previousOrigin;
    if (previousHostingFlag === undefined) delete process.env.KAI_HOSTING_V2; else process.env.KAI_HOSTING_V2 = previousHostingFlag;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the Hosting admin page is wired to live approval APIs and has no fake client-side ledger", () => {
  const component = readFileSync(new URL("../components/admin-hosting-operations.tsx", import.meta.url), "utf8");
  const navigation = readFileSync(new URL("../lib/admin-view-models.ts", import.meta.url), "utf8");
  assert.match(component, /\/api\/v2\/admin\/supply\/profiles/u);
  assert.match(component, /\/api\/v2\/admin\/hosting\/fees/u);
  assert.match(component, /\/api\/v2\/admin\/card-hours\/trial-grants/u);
  assert.match(component, /\/api\/v2\/admin\/hosting\/cleanup-incidents/u);
  assert.match(component, /FINANCE_APPROVER/u);
  assert.doesNotMatch(component, /localStorage|sessionStorage/u);
  assert.doesNotMatch(component, /status:\s*["'](?:CLEANED|VERIFIED|PUBLISHED)["']/u);
  assert.match(navigation, /href: "\/admin\/hosting"/u);

  const retryRoute = readFileSync(new URL("../app/api/v2/admin/hosting/cleanup-incidents/[contractId]/retry/route.ts", import.meta.url), "utf8");
  assert.match(retryRoute, /requireAdminPermission\(request, \["FULFILLMENT_OPERATE"\]\)/u);
  assert.match(retryRoute, /retryCleanup/u);
  assert.doesNotMatch(retryRoute, /updateOfferStatus|completeCommand/u);

  const marketplaceAuth = readFileSync(new URL("../lib/server/marketplace-auth.ts", import.meta.url), "utf8");
  assert.match(marketplaceAuth, /kai-cloud-account-session:v1/u);
});
