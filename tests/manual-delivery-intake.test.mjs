import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { GET as openMarketplaceSession } from "../app/api/session/route.ts";
import { POST as submitPurchaseIntent } from "../app/api/v1/catalog-purchase-intents/route.ts";
import { GET as listManualDeliveries } from "../app/api/v1/admin/manual-deliveries/route.ts";
import { GET as listSupplierCandidates } from "../app/api/v1/admin/manual-deliveries/supplier-candidates/route.ts";
import { POST as assignManualDelivery } from "../app/api/v1/admin/manual-deliveries/[demandId]/assign/route.ts";
import { POST as startManualDelivery } from "../app/api/v1/admin/manual-deliveries/[demandId]/start/route.ts";
import { POST as markManualDeliveryDelivered } from "../app/api/v1/admin/manual-deliveries/[demandId]/mark-delivered/route.ts";
import { POST as revokeManualDelivery } from "../app/api/v1/admin/manual-deliveries/[demandId]/revoke/route.ts";
import { GET as revealManualDeliveryKey } from "../app/api/v1/admin/manual-deliveries/[demandId]/ssh-public-key/route.ts";
import { GET as listMemberPurchaseIntents } from "../app/api/v1/member/purchase-intents/route.ts";
import { GET as getMemberPurchaseIntent } from "../app/api/v1/member/purchase-intents/[demandId]/route.ts";
import { POST as confirmMemberDelivery } from "../app/api/v1/member/purchase-intents/[demandId]/confirm-delivery/route.ts";
import { GET as listSupplierDeliveries } from "../app/api/v1/supply/manual-deliveries/route.ts";
import { GET as getSupplierDelivery } from "../app/api/v1/supply/manual-deliveries/[demandId]/route.ts";
import { createAccountSession } from "../lib/server/account-auth.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { createSqliteAdminOperationsStore } from "../lib/server/admin-store-sqlite.ts";
import { createSqliteMarketplaceStore } from "../lib/server/marketplace-store-sqlite.ts";
import { manualDeliveryIntakeEnabled } from "../lib/server/manual-delivery-intake.ts";
import { normalizeSshPublicKey } from "../lib/server/ssh-public-key.ts";

const ORIGIN = "http://localhost:3014";

function sshField(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function ed25519PublicKey(comment = "buyer-laptop", fill = 9) {
  const blob = Buffer.concat([sshField("ssh-ed25519"), sshField(Buffer.alloc(32, fill))]);
  return `ssh-ed25519 ${blob.toString("base64")} ${comment}`;
}

async function json(response, status) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

async function buyerSession(auth, now, subject = "manual-delivery-buyer") {
  const identity = await auth.resolveOrCreateKaiIdentity({
    issuer: "https://auth.kai.com/connect",
    subject,
    displayName: "H200 Buyer",
    verifiedEmail: `${subject.replaceAll(/[^a-z0-9]/giu, "-")}@example.com`,
    verifiedAt: now,
  });
  const issued = await createAccountSession(new Request(`${ORIGIN}/api/auth/kai/callback`), identity, "KAI_IDENTITY_OIDC", { store: auth, now: new Date(now) });
  const accountCookie = issued.cookie.split(";", 1)[0];
  const marketplaceResponse = await openMarketplaceSession(new Request(`${ORIGIN}/api/session`, { headers: { cookie: accountCookie } }));
  const marketplaceBody = await json(marketplaceResponse, 200);
  const marketplaceCookie = marketplaceResponse.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(marketplaceCookie);
  return { accountCookie, cookie: `${accountCookie}; ${marketplaceCookie}`, csrf: marketplaceBody.session.csrfToken, context: issued.context };
}

async function rootSession(auth, now) {
  const identity = await auth.resolveOrCreateIdentity({
    provider: "LOCAL", tenantKey: "LOCAL", subject: "manual-delivery-root", displayName: "Delivery Root",
    normalizedEmail: "delivery-root@kai.test", organizationExternalKey: "LOCAL:KAI", organizationName: "KAI Local Development", verifiedAt: now,
  });
  await auth.activateMembership(identity.membership.id, ["ROOT"], now);
  const issued = await createAccountSession(new Request(`${ORIGIN}/api/auth/login`), identity, "ADMIN_PASSWORD", { store: auth, now: new Date(now) });
  return issued.cookie.split(";", 1)[0];
}

function purchaseRequest(session, key, sshPublicKey, resourceId = "gpu-honghuan-h200-nvl-1") {
  return new Request(`${ORIGIN}/api/v1/catalog-purchase-intents`, {
    method: "POST",
    headers: {
      cookie: session.cookie,
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-kai-csrf": session.csrf,
      "Idempotency-Key": key,
    },
    body: JSON.stringify({ resourceId, quantity: 1, durationHours: 3, deliveryDate: "2026-09-01", note: "人工开通测试", sshPublicKey }),
  });
}

function writeRequest(path, cookie, idempotencyKey, body) {
  return new Request(`${ORIGIN}${path}`, { method:"POST", headers:{ cookie, origin:ORIGIN, "sec-fetch-site":"same-origin", "content-type":"application/json", "Idempotency-Key":`manual-${idempotencyKey}-0001` }, body:JSON.stringify(body) });
}

test("manual delivery flag is explicit and SSH keys are structurally validated", async () => {
  assert.equal(manualDeliveryIntakeEnabled({}), false);
  assert.equal(manualDeliveryIntakeEnabled({ KAI_MANUAL_DELIVERY_INTAKE: "1" }), true);
  const valid = ed25519PublicKey();
  assert.match((await normalizeSshPublicKey(valid)).fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/u);
  for (const invalid of [
    `${valid}\ncommand=malicious`,
    `from=\"10.0.0.1\" ${valid}`,
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "ssh-rsa AAAA",
  ]) await assert.rejects(normalizeSshPublicKey(invalid), (error) => error.code === "SSH_PUBLIC_KEY_INVALID");
});

test("buyer public key is privately persisted and only an authorized administrator can reveal it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-manual-delivery-"));
  const path = join(directory, "kai-cloud.sqlite");
  const previous = {
    directory: process.env.KAI_DB_DIR,
    legacy: process.env.KAI_ALLOW_LEGACY_ANON_WRITES,
    flag: process.env.KAI_MANUAL_DELIVERY_INTAKE,
    buyFlag: process.env.KAI_BUY_CATALOG_V2,
    account: globalThis.__kaiAccountAuthStorePromise,
    marketplace: globalThis.__kaiMarketplaceStorePromise,
    admin: globalThis.__kaiAdminOperationsStorePromise,
  };
  process.env.KAI_DB_DIR = directory;
  process.env.KAI_MANUAL_DELIVERY_INTAKE = "1";
  process.env.KAI_BUY_CATALOG_V2 = "1";
  delete process.env.KAI_ALLOW_LEGACY_ANON_WRITES;
  const auth = await createSqliteAccountAuthStore(path);
  const admin = await createSqliteAdminOperationsStore(path);
  const marketplace = createSqliteMarketplaceStore();
  globalThis.__kaiAccountAuthStorePromise = Promise.resolve(auth);
  globalThis.__kaiAdminOperationsStorePromise = Promise.resolve(admin);
  globalThis.__kaiMarketplaceStorePromise = Promise.resolve(marketplace);

  try {
    const now = new Date().toISOString();
    const buyer = await buyerSession(auth, now);
    const rootCookie = await rootSession(auth, now);
    const sourceKey = ed25519PublicKey("must-not-be-stored");
    const canonical = sourceKey.split(" ").slice(0, 2).join(" ");
    process.env.KAI_BUY_CATALOG_V2 = "0";
    const catalogDisabled = await json(await submitPurchaseIntent(purchaseRequest(buyer, "buy-catalog-disabled", sourceKey)), 400);
    assert.equal(catalogDisabled.error.code, "VALIDATION_ERROR");
    process.env.KAI_BUY_CATALOG_V2 = "1";
    process.env.KAI_MANUAL_DELIVERY_INTAKE = "0";
    const disabled = await json(await submitPurchaseIntent(purchaseRequest(buyer, "manual-delivery-disabled", sourceKey)), 400);
    assert.equal(disabled.error.code, "VALIDATION_ERROR");
    process.env.KAI_MANUAL_DELIVERY_INTAKE = "1";
    const referenceLead = await json(await submitPurchaseIntent(purchaseRequest(buyer, "manual-delivery-reference", sourceKey, "gpu-supplier-reference-001")), 400);
    assert.equal(referenceLead.error.code, "VALIDATION_ERROR");
    const sample = await json(await submitPurchaseIntent(purchaseRequest(buyer, "manual-delivery-sample", sourceKey, "gpu-h100-sxm-8-bj")), 400);
    assert.equal(sample.error.code, "VALIDATION_ERROR");
    const oversized = await json(await submitPurchaseIntent(purchaseRequest(buyer, "manual-delivery-oversized", "x".repeat(12 * 1024 + 1))), 400);
    assert.equal(oversized.error.code, "VALIDATION_ERROR");
    let failSnapshotOnce = true;
    globalThis.__kaiAdminOperationsStorePromise = Promise.resolve(new Proxy(admin, { get(target, property, receiver) {
      if (property === "recordCatalogPurchaseIntentSnapshot" && failSnapshotOnce) return async () => { failSnapshotOnce = false; throw new Error("simulated snapshot outage"); };
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } }));
    await json(await submitPurchaseIntent(purchaseRequest(buyer, "manual-delivery-h200", sourceKey)), 500);
    const stagedDb = new DatabaseSync(path);
    let stagedId, stagedOwner;
    try {
      const staged = stagedDb.prepare("SELECT id,owner_actor_id,visibility FROM marketplace_requests_v2 WHERE idempotency_key=?").get("manual-delivery-h200");
      assert.equal(staged.visibility, "private");
      stagedId = staged.id;
      stagedOwner = staged.owner_actor_id;
    } finally { stagedDb.close(); }
    assert.equal((await marketplace.listOwnedRequests(stagedOwner, { limit: 100, cursor: null })).items.some((item) => item.id === stagedId), false);
    assert.equal((await marketplace.listPublicRequests({ limit: 100, cursor: null })).items.some((item) => item.id === stagedId), false);
    globalThis.__kaiAdminOperationsStorePromise = Promise.resolve(admin);
    const first = await json(await submitPurchaseIntent(purchaseRequest(buyer, "manual-delivery-h200", sourceKey)), 200);
    assert.equal(first.manualDelivery.mode, "MANUAL_SSH");
    assert.equal(first.manualDelivery.status, "PENDING_MANUAL_DELIVERY");
    assert.equal(first.purchaseDetails.href, `/member/purchases/${first.record.id}`);
    assert.doesNotMatch(JSON.stringify(first), /must-not-be-stored/u);
    assert.match(first.priceSnapshot.unitPriceCardHours, /^\d+\.\d{2}$/u);
    assert.match(first.priceSnapshot.estimatedCardHours, /^\d+\.\d{2}$/u);
    assert.doesNotMatch(JSON.stringify(first.priceSnapshot), /¥|CNY|referenceCurrency|estimatedAmount|estimatedCardHourMicros/u);

    const replay = await json(await submitPurchaseIntent(purchaseRequest(buyer, "manual-delivery-h200", sourceKey)), 200);
    assert.equal(replay.record.id, first.record.id);
    const conflict = await json(await submitPurchaseIntent(purchaseRequest(buyer, "manual-delivery-h200", ed25519PublicKey("alternate", 10))), 409);
    assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal((await admin.listManualDeliveryIntakes()).length, 1);

    const ownList = await json(await listMemberPurchaseIntents(new Request(`${ORIGIN}/api/v1/member/purchase-intents`, { headers: { cookie: buyer.accountCookie } })), 200);
    assert.equal(ownList.records.length, 1);
    assert.equal(ownList.records[0].demandId, first.record.id);
    assert.equal(ownList.records[0].resource.id, "gpu-honghuan-h200-nvl-1");
    assert.equal(ownList.records[0].request.totalGpuCount, 1);
    assert.equal(ownList.records[0].request.durationHours, 3);
    assert.equal(ownList.records[0].status, "PENDING_MANUAL_DELIVERY");
    assert.equal(ownList.records[0].sshPublicKeyFingerprint, first.manualDelivery.sshPublicKeyFingerprint);
    assert.doesNotMatch(JSON.stringify(ownList), /ssh-ed25519|must-not-be-stored|buyerOrganizationId|buyerAccountId|payloadHash|idempotencyKey/u);

    const ownDetail = await json(await getMemberPurchaseIntent(new Request(`${ORIGIN}/api/v1/member/purchase-intents/${first.record.id}`, { headers: { cookie: buyer.accountCookie } }), { params: Promise.resolve({ demandId: first.record.id }) }), 200);
    assert.deepEqual(ownDetail.record, ownList.records[0]);
    const otherBuyer = await buyerSession(auth, now, "manual-delivery-other-buyer");
    const crossTenant = await json(await getMemberPurchaseIntent(new Request(`${ORIGIN}/api/v1/member/purchase-intents/${first.record.id}`, { headers: { cookie: otherBuyer.accountCookie } }), { params: Promise.resolve({ demandId: first.record.id }) }), 404);
    assert.equal(crossTenant.error.code, "PURCHASE_INTENT_NOT_FOUND");
    assert.equal((await json(await listMemberPurchaseIntents(new Request(`${ORIGIN}/api/v1/member/purchase-intents`, { headers: { cookie: otherBuyer.accountCookie } })), 200)).records.length, 0);
    assert.equal((await json(await listMemberPurchaseIntents(new Request(`${ORIGIN}/api/v1/member/purchase-intents`)), 401)).error.code, "ACCOUNT_AUTH_REQUIRED");

    const compensationDb = new DatabaseSync(path);
    try {
      compensationDb.prepare("DELETE FROM admin_catalog_purchase_intent_snapshots WHERE demand_id=?").run(first.record.id);
      compensationDb.prepare("DELETE FROM admin_command_receipts WHERE actor_principal_id=? AND idempotency_key=?").run(buyer.context.account.id, "catalog-purchase-snapshot:manual-delivery-h200");
    } finally { compensationDb.close(); }
    const repaired = await json(await submitPurchaseIntent(purchaseRequest(buyer, "manual-delivery-h200", sourceKey)), 200);
    assert.equal(repaired.purchaseDetails.demandId, first.record.id);
    assert.equal((await admin.listMemberCatalogPurchaseIntents(buyer.context.activeOrganization.id)).length, 1);

    const supplier = await buyerSession(auth, now, "manual-delivery-supplier");
    const qualificationDb = new DatabaseSync(path);
    try {
      qualificationDb.exec("CREATE TABLE IF NOT EXISTS supply_offers(id TEXT PRIMARY KEY,status TEXT NOT NULL)");
      qualificationDb.prepare("INSERT INTO supply_offers(id,status) VALUES(?,?)").run("qualified-offer", "VERIFIED");
      qualificationDb.prepare("INSERT INTO supply_offers(id,status) VALUES(?,?)").run("unqualified-offer", "SUBMITTED");
      qualificationDb.prepare(`INSERT INTO admin_entity_ownership(source_system,entity_type,entity_id,organization_id,account_id,legacy_actor_id,bound_by_principal_id,created_at,updated_at,version)
        VALUES('SUPPLY_PILOT','SUPPLY_OFFER',?,?,?,?,?,?,?,1)`).run("qualified-offer", supplier.context.activeOrganization.id, supplier.context.account.id, null, "test", now, now);
      qualificationDb.prepare(`INSERT INTO admin_entity_ownership(source_system,entity_type,entity_id,organization_id,account_id,legacy_actor_id,bound_by_principal_id,created_at,updated_at,version)
        VALUES('SUPPLY_PILOT','SUPPLY_OFFER',?,?,?,?,?,?,?,1)`).run("unqualified-offer", otherBuyer.context.activeOrganization.id, otherBuyer.context.account.id, null, "test", now, now);
    } finally { qualificationDb.close(); }
    const candidateBody=await json(await listSupplierCandidates(new Request(`${ORIGIN}/api/v1/admin/manual-deliveries/supplier-candidates`,{headers:{cookie:rootCookie}})),200);
    assert.deepEqual(candidateBody.records,[{organizationId:supplier.context.activeOrganization.id,organizationName:supplier.context.activeOrganization.name}]);
    await json(await listSupplierCandidates(new Request(`${ORIGIN}/api/v1/admin/manual-deliveries/supplier-candidates`,{headers:{cookie:buyer.accountCookie}})),403);
    const params={params:Promise.resolve({demandId:first.record.id})};
    const assigned=await json(await assignManualDelivery(writeRequest(`/api/v1/admin/manual-deliveries/${first.record.id}/assign`,rootCookie,"assign",{expectedVersion:1,supplierOrganizationId:supplier.context.activeOrganization.id}),params),201);
    assert.equal(assigned.record.status,"SUPPLIER_ASSIGNED");
    const assignedReplay=await json(await assignManualDelivery(writeRequest(`/api/v1/admin/manual-deliveries/${first.record.id}/assign`,rootCookie,"assign",{expectedVersion:1,supplierOrganizationId:supplier.context.activeOrganization.id}),params),200);
    assert.equal(assignedReplay.record.statusVersion,2);
    assert.equal((await json(await startManualDelivery(writeRequest(`/api/v1/admin/manual-deliveries/${first.record.id}/start`,rootCookie,"start",{expectedVersion:2}),params),201)).record.status,"DELIVERY_IN_PROGRESS");
    await json(await markManualDeliveryDelivered(writeRequest(`/api/v1/admin/manual-deliveries/${first.record.id}/mark-delivered`,rootCookie,"bad-delivery",{expectedVersion:3,connection:{host:"gpu.example.com",port:22,username:"root",hostKeyFingerprint:"unsafe"}}),params),400);
    await json(await markManualDeliveryDelivered(writeRequest(`/api/v1/admin/manual-deliveries/${first.record.id}/mark-delivered`,rootCookie,"malicious-host",{expectedVersion:3,connection:{host:"$(touch /tmp/pwn)",port:22,username:"root",hostKeyFingerprint:`SHA256:${"A".repeat(43)}`}}),params),400);
    const delivered=await json(await markManualDeliveryDelivered(writeRequest(`/api/v1/admin/manual-deliveries/${first.record.id}/mark-delivered`,rootCookie,"delivered",{expectedVersion:3,buyerVisibleNote:"实例已经开通。",connection:{host:"gpu.example.com",port:22,username:"root",hostKeyFingerprint:`SHA256:${"A".repeat(43)}`}}),params),201);
    assert.equal(delivered.record.status,"AWAITING_BUYER_ACCEPTANCE");
    const supplierList=await json(await listSupplierDeliveries(new Request(`${ORIGIN}/api/v1/supply/manual-deliveries`,{headers:{cookie:supplier.accountCookie,"x-kai-workspace-role":"supplier"}})),200);
    assert.equal(supplierList.records.length,1);
    assert.doesNotMatch(JSON.stringify(supplierList),/buyerAccountId|buyerOrganizationId|internalNote|canonicalSshPublicKey|ssh-ed25519|pricing|connection/u);
    const supplierDetail=await json(await getSupplierDelivery(new Request(`${ORIGIN}/api/v1/supply/manual-deliveries/${first.record.id}`,{headers:{cookie:supplier.accountCookie,"x-kai-workspace-role":"supplier"}}),params),200);
    assert.deepEqual(supplierDetail.record,supplierList.records[0]);
    assert.equal((await json(await listSupplierDeliveries(new Request(`${ORIGIN}/api/v1/supply/manual-deliveries`,{headers:{cookie:otherBuyer.accountCookie,"x-kai-workspace-role":"supplier"}})),200)).records.length,0);
    await json(await getSupplierDelivery(new Request(`${ORIGIN}/api/v1/supply/manual-deliveries/${first.record.id}`,{headers:{cookie:otherBuyer.accountCookie,"x-kai-workspace-role":"supplier"}}),params),404);
    await json(await confirmMemberDelivery(writeRequest(`/api/v1/member/purchase-intents/${first.record.id}/confirm-delivery`,otherBuyer.accountCookie,"cross-confirm",{expectedVersion:4}),params),404);
    const completed=await json(await confirmMemberDelivery(writeRequest(`/api/v1/member/purchase-intents/${first.record.id}/confirm-delivery`,buyer.accountCookie,"confirm",{expectedVersion:4}),params),201);
    assert.equal(completed.record.status,"COMPLETED");
    assert.equal(completed.record.connection.host,"gpu.example.com");
    assert.equal((await json(await confirmMemberDelivery(writeRequest(`/api/v1/member/purchase-intents/${first.record.id}/confirm-delivery`,buyer.accountCookie,"confirm",{expectedVersion:4}),params),200)).record.statusVersion,5);
    await json(await revokeManualDelivery(writeRequest(`/api/v1/admin/manual-deliveries/${first.record.id}/revoke`,rootCookie,"revoke",{expectedVersion:5,reason:"Access was explicitly revoked after buyer acceptance."}),params),201);
    const revoked=await json(await getMemberPurchaseIntent(new Request(`${ORIGIN}/api/v1/member/purchase-intents/${first.record.id}`,{headers:{cookie:buyer.accountCookie}}),params),200);
    assert.equal(revoked.record.status,"ACCESS_REVOKED");
    assert.equal(revoked.record.connection,null);

    const deniedList = await json(await listManualDeliveries(new Request(`${ORIGIN}/api/v1/admin/manual-deliveries`, { headers: { cookie: buyer.accountCookie } })), 403);
    assert.equal(deniedList.error.code, "ADMIN_ACCESS_FORBIDDEN");
    const listed = await json(await listManualDeliveries(new Request(`${ORIGIN}/api/v1/admin/manual-deliveries`, { headers: { cookie: rootCookie } })), 200);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].sshPublicKeyFingerprint, first.manualDelivery.sshPublicKeyFingerprint);
    assert.equal(JSON.stringify(listed).includes(canonical), false);

    const second = await json(await submitPurchaseIntent(purchaseRequest(buyer, "manual-delivery-second", sourceKey, "gpu-honghuan-h100-sxm-80gb-1")), 201);
    const secondParams = { params: Promise.resolve({ demandId: second.record.id }) };
    const crossTaskAdminReplay = await json(await assignManualDelivery(writeRequest(`/api/v1/admin/manual-deliveries/${second.record.id}/assign`, rootCookie, "assign", { expectedVersion: 1, supplierOrganizationId: supplier.context.activeOrganization.id }), secondParams), 409);
    assert.equal(crossTaskAdminReplay.error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal((await admin.getManualDeliveryIntake(second.record.id)).status, "PENDING_MANUAL_DELIVERY");
    await json(await assignManualDelivery(writeRequest(`/api/v1/admin/manual-deliveries/${second.record.id}/assign`, rootCookie, "assign-second", { expectedVersion: 1, supplierOrganizationId: supplier.context.activeOrganization.id }), secondParams), 201);
    await json(await startManualDelivery(writeRequest(`/api/v1/admin/manual-deliveries/${second.record.id}/start`, rootCookie, "start-second", { expectedVersion: 2 }), secondParams), 201);
    await json(await markManualDeliveryDelivered(writeRequest(`/api/v1/admin/manual-deliveries/${second.record.id}/mark-delivered`, rootCookie, "delivered-second", { expectedVersion: 3, connection: { host: "gpu-2.example.com", port: 22, username: "root", hostKeyFingerprint: `SHA256:${"B".repeat(43)}` } }), secondParams), 201);
    const crossTaskBuyerReplay = await json(await confirmMemberDelivery(writeRequest(`/api/v1/member/purchase-intents/${second.record.id}/confirm-delivery`, buyer.accountCookie, "confirm", { expectedVersion: 4 }), secondParams), 409);
    assert.equal(crossTaskBuyerReplay.error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal((await admin.getMemberCatalogPurchaseIntent(buyer.context.activeOrganization.id, second.record.id)).status, "AWAITING_BUYER_ACCEPTANCE");

    const deniedReveal = await json(await revealManualDeliveryKey(new Request(`${ORIGIN}/api/v1/admin/manual-deliveries/${first.record.id}/ssh-public-key`, { headers: { cookie: buyer.accountCookie } }), { params: Promise.resolve({ demandId: first.record.id }) }), 403);
    assert.equal(deniedReveal.error.code, "ADMIN_ACCESS_FORBIDDEN");
    const revealed = await json(await revealManualDeliveryKey(new Request(`${ORIGIN}/api/v1/admin/manual-deliveries/${first.record.id}/ssh-public-key`, { headers: { cookie: rootCookie } }), { params: Promise.resolve({ demandId: first.record.id }) }), 200);
    assert.equal(revealed.record.canonicalSshPublicKey, canonical);
    assert.equal(revealed.record.canonicalSshPublicKey.includes("must-not-be-stored"), false);

    const db = new DatabaseSync(path);
    try {
      const demand = db.prepare("SELECT summary FROM marketplace_requests_v2 WHERE id=?").get(first.record.id);
      const audit = db.prepare("SELECT action,reason,payload_digest FROM admin_audit_events WHERE entity_id=? ORDER BY occurred_at").all(first.record.id);
      const receipts = db.prepare("SELECT response_json FROM admin_command_receipts WHERE actor_principal_id=?").all(buyer.context.account.id);
      const snapshot = db.prepare("SELECT resource_snapshot_json,unit_price_cny_cents,unit_card_hour_micros,estimated_card_hour_micros FROM admin_catalog_purchase_intent_snapshots WHERE demand_id=?").get(first.record.id);
      assert.equal(JSON.stringify(demand).includes(canonical), false);
      assert.equal(JSON.stringify(demand).includes(first.manualDelivery.sshPublicKeyFingerprint), false);
      assert.equal(JSON.stringify(audit).includes(canonical), false);
      assert.equal(JSON.stringify(receipts).includes(canonical), false);
      assert.equal(JSON.stringify(snapshot).includes(canonical), false);
      assert.equal(JSON.parse(snapshot.resource_snapshot_json).title, "H200 NVL · 单卡");
      assert.ok(snapshot.unit_card_hour_micros > 0);
      assert.ok(snapshot.estimated_card_hour_micros > snapshot.unit_card_hour_micros);
      assert.ok(audit.some((event) => event.action === "MANUAL_DELIVERY_KEY_REVEALED"));
    } finally { db.close(); }
  } finally {
    auth.close(); admin.close(); marketplace.close();
    globalThis.__kaiAccountAuthStorePromise = previous.account;
    globalThis.__kaiMarketplaceStorePromise = previous.marketplace;
    globalThis.__kaiAdminOperationsStorePromise = previous.admin;
    if (previous.directory === undefined) delete process.env.KAI_DB_DIR; else process.env.KAI_DB_DIR = previous.directory;
    if (previous.legacy === undefined) delete process.env.KAI_ALLOW_LEGACY_ANON_WRITES; else process.env.KAI_ALLOW_LEGACY_ANON_WRITES = previous.legacy;
    if (previous.flag === undefined) delete process.env.KAI_MANUAL_DELIVERY_INTAKE; else process.env.KAI_MANUAL_DELIVERY_INTAKE = previous.flag;
    if (previous.buyFlag === undefined) delete process.env.KAI_BUY_CATALOG_V2; else process.env.KAI_BUY_CATALOG_V2 = previous.buyFlag;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("manual delivery migration mirrors remain byte-identical and additive", () => {
  const local = readFileSync(new URL("../drizzle/0029_admin_manual_delivery.sql", import.meta.url), "utf8");
  assert.equal(local, readFileSync(new URL("../.openai/drizzle/0029_admin_manual_delivery.sql", import.meta.url), "utf8"));
  assert.equal(local, readFileSync(new URL("../dist/.openai/drizzle/0029_admin_manual_delivery.sql", import.meta.url), "utf8"));
  assert.match(local, /admin_manual_delivery_intakes/u);
  assert.doesNotMatch(local, /admin_operations_schema_migrations|VALUES\s*\(\s*4\b/iu);
  const purchaseSnapshot = readFileSync(new URL("../drizzle/0030_admin_catalog_purchase_intent_snapshots.sql", import.meta.url), "utf8");
  assert.equal(purchaseSnapshot, readFileSync(new URL("../.openai/drizzle/0030_admin_catalog_purchase_intent_snapshots.sql", import.meta.url), "utf8"));
  assert.match(purchaseSnapshot, /admin_catalog_purchase_intent_snapshots/u);
  assert.doesNotMatch(purchaseSnapshot, /DROP\s+TABLE|DELETE\s+FROM|admin_operations_schema_migrations/iu);
});

test("production compose passes the fail-closed manual delivery flag into the application", () => {
  const compose = readFileSync(new URL("../deploy/compose.production.yml", import.meta.url), "utf8");
  const environment = readFileSync(new URL("../deploy/kai-cloud-app.env.example", import.meta.url), "utf8");
  assert.match(compose, /KAI_MANUAL_DELIVERY_INTAKE: "\$\{KAI_MANUAL_DELIVERY_INTAKE:-0\}"/u);
  assert.match(environment, /^KAI_MANUAL_DELIVERY_INTAKE=0$/mu);
});
