import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { GET as openMarketplaceSession } from "../app/api/session/route.ts";
import { POST as submitPurchaseIntent } from "../app/api/v1/catalog-purchase-intents/route.ts";
import { GET as listManualDeliveries } from "../app/api/v1/admin/manual-deliveries/route.ts";
import { GET as revealManualDeliveryKey } from "../app/api/v1/admin/manual-deliveries/[demandId]/ssh-public-key/route.ts";
import { GET as listMemberPurchaseIntents } from "../app/api/v1/member/purchase-intents/route.ts";
import { GET as getMemberPurchaseIntent } from "../app/api/v1/member/purchase-intents/[demandId]/route.ts";
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

function purchaseRequest(session, key, sshPublicKey) {
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
    body: JSON.stringify({ resourceId: "gpu-h100-sxm-8-bj", quantity: 1, durationHours: 3, deliveryDate: "2026-09-01", note: "人工开通测试", sshPublicKey }),
  });
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
    account: globalThis.__kaiAccountAuthStorePromise,
    marketplace: globalThis.__kaiMarketplaceStorePromise,
    admin: globalThis.__kaiAdminOperationsStorePromise,
  };
  process.env.KAI_DB_DIR = directory;
  process.env.KAI_MANUAL_DELIVERY_INTAKE = "1";
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
    const oversized = await json(await submitPurchaseIntent(purchaseRequest(buyer, "manual-delivery-oversized", "x".repeat(12 * 1024 + 1))), 400);
    assert.equal(oversized.error.code, "VALIDATION_ERROR");
    const first = await json(await submitPurchaseIntent(purchaseRequest(buyer, "manual-delivery-h200", sourceKey)), 201);
    assert.equal(first.manualDelivery.mode, "MANUAL_SSH");
    assert.equal(first.manualDelivery.status, "PENDING_MANUAL_DELIVERY");
    assert.equal(first.purchaseDetails.href, `/member/purchases/${first.record.id}`);
    assert.doesNotMatch(JSON.stringify(first), /must-not-be-stored/u);

    const replay = await json(await submitPurchaseIntent(purchaseRequest(buyer, "manual-delivery-h200", sourceKey)), 200);
    assert.equal(replay.record.id, first.record.id);
    const conflict = await json(await submitPurchaseIntent(purchaseRequest(buyer, "manual-delivery-h200", ed25519PublicKey("alternate", 10))), 409);
    assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal((await admin.listManualDeliveryIntakes()).length, 1);

    const ownList = await json(await listMemberPurchaseIntents(new Request(`${ORIGIN}/api/v1/member/purchase-intents`, { headers: { cookie: buyer.accountCookie } })), 200);
    assert.equal(ownList.records.length, 1);
    assert.equal(ownList.records[0].demandId, first.record.id);
    assert.equal(ownList.records[0].resource.id, "gpu-h100-sxm-8-bj");
    assert.equal(ownList.records[0].request.totalGpuCount, 8);
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

    const deniedList = await json(await listManualDeliveries(new Request(`${ORIGIN}/api/v1/admin/manual-deliveries`, { headers: { cookie: buyer.accountCookie } })), 403);
    assert.equal(deniedList.error.code, "ADMIN_ACCESS_FORBIDDEN");
    const listed = await json(await listManualDeliveries(new Request(`${ORIGIN}/api/v1/admin/manual-deliveries`, { headers: { cookie: rootCookie } })), 200);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].sshPublicKeyFingerprint, first.manualDelivery.sshPublicKeyFingerprint);
    assert.equal(JSON.stringify(listed).includes(canonical), false);

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
      assert.equal(JSON.parse(snapshot.resource_snapshot_json).title, "H100 SXM 80GB · 8 卡训练节点");
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
