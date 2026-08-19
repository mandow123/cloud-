import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { accountConsoleSupplierStatus, getAccountConsoleSummary } from "../lib/server/account-console-summary.ts";
import { createSqliteAdminOperationsStore } from "../lib/server/admin-store-sqlite.ts";
import { createSqliteSupplyStore } from "../lib/server/supply-store-sqlite.ts";

const NOW = "2026-08-19T07:00:00.000Z";
const session = {
  account: { id: "acct-current", displayName: "KAI Buyer", primaryEmail: "buyer@example.com", status: "ACTIVE" },
  activeOrganization: { id: "org-current", name: "Current Organization", externalKey: "PRIVATE:CURRENT", status: "ACTIVE" },
  membership: { id: "mbr-current", accountId: "acct-current", organizationId: "org-current", status: "ACTIVE", roles: ["BUYER"] },
  sessionId: "session-private",
  authMethod: "KAI_IDENTITY_OIDC",
};

const emptyDashboard = {
  assetCode: "KAI_CREDIT_HOUR",
  rate: { cardHours: "1", cny: "1.002", topupBlockCardHours: "5", topupBlockCny: "5.01" },
  balance: { availableMicros: 12_340_000, heldMicros: 500_000, lifetimeTopupMicros: 20_000_000, lifetimeSpentMicros: 7_160_000 },
  topups: [], purchases: [], buybacks: [],
  income: { rentalPendingMicros: 0, rentalVestedMicros: 0, commissionPendingMicros: 0, commissionVestedMicros: 0 },
  referral: { code: "PRIVATE-CODE", invitedOrganizations: 0 }, ledger: [],
};

test("account console summary reads only the active organization and returns a safe DTO", async () => {
  const reads = [];
  const summary = await getAccountConsoleSummary(new Request("http://localhost/api/v1/member/account-console-summary"), {
    requireSession: async () => session,
    readCardHours: async (organizationId, asOf) => {
      reads.push({ source: "card-hours", organizationId, asOf });
      return emptyDashboard;
    },
    readRecords: async (organizationId) => {
      reads.push({ source: "records", organizationId });
      return {
        purchaseIntents: {
          total: 1,
          pendingManualDelivery: 1,
          recent: [{ demandId: "demand-current", status: "PENDING_MANUAL_DELIVERY", resourceTitle: "H200 NVL 单卡", supplierName: "供应商", estimatedCardHourMicros: 4_239_520_958, createdAt: NOW, updatedAt: NOW }],
        },
        supplyApplications: {
          total: 1,
          pendingReview: 1,
          approved: 0,
          verified: 0,
          published: 0,
          needsAttention: 0,
          recent: [{ id: "supply-current", productName: "8×H100", resourceType: "GPU_SERVER", status: "SUBMITTED", createdAt: NOW, updatedAt: NOW }],
        },
      };
    },
    now: () => new Date(NOW),
  });

  assert.deepEqual(reads, [
    { source: "card-hours", organizationId: "org-current", asOf: NOW },
    { source: "records", organizationId: "org-current" },
  ]);
  assert.deepEqual(summary.buyer.cardHours, { availableMicros: 12_340_000, heldMicros: 500_000 });
  assert.equal("lifetimeTopupMicros" in summary.buyer.cardHours, false);
  assert.equal("lifetimeSpentMicros" in summary.buyer.cardHours, false);
  assert.equal(summary.buyer.purchaseIntents.pendingManualDelivery, 1);
  assert.equal(summary.supplier.available, true);
  assert.equal(summary.supplier.approved, false);
  assert.equal(summary.supplier.status, "PENDING_REVIEW");
  assert.equal(summary.supplier.applications.pendingReview, 1);
  const encoded = JSON.stringify(summary);
  for (const secret of ["acct-current", "org-current", "PRIVATE:CURRENT", "buyer@example.com", "session-private", "PRIVATE-CODE"]) {
    assert.equal(encoded.includes(secret), false, `safe summary must not expose ${secret}`);
  }
});

test("supplier account status distinguishes verified records from published records", () => {
  const base = { total: 1, pendingReview: 0, approved: 1, verified: 0, published: 0, needsAttention: 0, recent: [] };
  assert.equal(accountConsoleSupplierStatus({ ...base, verified: 1 }), "VERIFIED_NOT_PUBLISHED");
  assert.equal(accountConsoleSupplierStatus({ ...base, published: 1 }), "PUBLISHED");
  assert.equal(accountConsoleSupplierStatus({ ...base, total: 2, verified: 1, published: 1 }), "PUBLISHED");
});

test("account console summary propagates storage errors instead of replacing them with zero", async () => {
  await assert.rejects(() => getAccountConsoleSummary(new Request("http://localhost/api/v1/member/account-console-summary"), {
    requireSession: async () => session,
    readCardHours: async () => { throw new Error("CARD_HOUR_STORAGE_UNAVAILABLE"); },
    readRecords: async () => ({
      purchaseIntents: { total: 0, pendingManualDelivery: 0, recent: [] },
      supplyApplications: { total: 0, pendingReview: 0, approved: 0, verified: 0, published: 0, needsAttention: 0, recent: [] },
    }),
    now: () => new Date(NOW),
  }), /CARD_HOUR_STORAGE_UNAVAILABLE/u);
});

test("console record aggregation is organization-bound for purchases and supply applications", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-account-console-"));
  const path = join(directory, "console.sqlite");
  let admin;
  try {
    admin = await createSqliteAdminOperationsStore(path);
    await createSqliteSupplyStore(path);
    const database = new DatabaseSync(path);
    const resource = (title, supplierName) => JSON.stringify({
      id: `resource-${title}`, title, supplierId: `supplier-${supplierName}`, supplierName, supplierLogoUrl: null,
      category: "gpu", region: "华东", deliveryForm: "人工交付", summary: title, capacity: "询价确认", sla: "人工确认",
      deliveryLeadTime: "人工确认", sourceNotice: null, gpuDescription: title, gpuPackageCount: 1, specs: { GPU: title },
    });
    const insertPurchase = database.prepare(`INSERT INTO admin_catalog_purchase_intent_snapshots(
      demand_id,buyer_organization_id,buyer_account_id,resource_id,resource_title,resource_snapshot_json,
      quantity,duration_hours,delivery_date,pricing_unit,unit_price_cny_cents,unit_card_hour_micros,
      estimated_card_hour_micros,status,idempotency_key,payload_hash,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,1,24,NULL,'CARD_HOUR',100,1000000,24000000,'PENDING_MANUAL_DELIVERY',?,?,?,?)`);
    insertPurchase.run("demand-current-new", "org-current", "acct-current", "gpu-current-new", "Current New", resource("Current New", "Supplier Current"), "idem-current-new", "hash-current-new", "2026-08-19T07:02:00.000Z", "2026-08-19T07:02:00.000Z");
    insertPurchase.run("demand-current-old", "org-current", "acct-current", "gpu-current-old", "Current Old", resource("Current Old", "Supplier Current"), "idem-current-old", "hash-current-old", "2026-08-19T07:01:00.000Z", "2026-08-19T07:01:00.000Z");
    insertPurchase.run("demand-other", "org-other", "acct-other", "gpu-other", "Other Secret GPU", resource("Other Secret GPU", "Other Secret Supplier"), "idem-other", "hash-other", "2026-08-19T07:03:00.000Z", "2026-08-19T07:03:00.000Z");

    const insertSupply = database.prepare(`INSERT INTO supply_offers(
      id,supplier_actor_id,idempotency_key,payload_hash,supplier_type,resource_type,quantity,quantity_unit,
      pricing_unit,product_name,specification,region,delivery_form,availability_start_at,availability_end_at,
      notes,status,version,created_at,updated_at
    ) VALUES(?,?,?,?,'COMPANY','GPU_SERVER',1,'NODE','NODE_HOUR',?,'spec','华东','人工交付',NULL,NULL,NULL,?,1,?,?)`);
    insertSupply.run("supply-current-new", "actor-current", "supply-idem-current-new", "supply-hash-current-new", "Current H200", "UNDER_VERIFICATION", "2026-08-19T07:04:00.000Z", "2026-08-19T07:04:00.000Z");
    insertSupply.run("supply-current-old", "actor-current", "supply-idem-current-old", "supply-hash-current-old", "Current H100", "VERIFIED", "2026-08-19T07:00:00.000Z", "2026-08-19T07:00:00.000Z");
    insertSupply.run("supply-other", "actor-other", "supply-idem-other", "supply-hash-other", "Other Secret B300", "SUBMITTED", "2026-08-19T07:05:00.000Z", "2026-08-19T07:05:00.000Z");
    insertSupply.run("supply-unbound", "actor-unbound", "supply-idem-unbound", "supply-hash-unbound", "Unbound Secret GPU", "SUBMITTED", "2026-08-19T07:06:00.000Z", "2026-08-19T07:06:00.000Z");

    const insertOwnership = database.prepare(`INSERT INTO admin_entity_ownership(
      source_system,entity_type,entity_id,organization_id,account_id,legacy_actor_id,bound_by_principal_id,created_at,updated_at,version
    ) VALUES(?,?,?,?,?,NULL,?,?,?,1)`);
    for (const [sourceSystem, entityType, entityId, organizationId, accountId] of [
      ["MARKETPLACE", "DEMAND", "demand-current-new", "org-current", "acct-current"],
      ["MARKETPLACE", "DEMAND", "demand-current-old", "org-current", "acct-current"],
      ["MARKETPLACE", "DEMAND", "demand-other", "org-other", "acct-other"],
      ["SUPPLY_PILOT", "SUPPLY_OFFER", "supply-current-new", "org-current", "acct-current"],
      ["SUPPLY_PILOT", "SUPPLY_OFFER", "supply-current-old", "org-current", "acct-current"],
      ["SUPPLY_PILOT", "SUPPLY_OFFER", "supply-other", "org-other", "acct-other"],
    ]) insertOwnership.run(sourceSystem, entityType, entityId, organizationId, accountId, accountId, NOW, NOW);
    database.close();

    const current = await admin.getMemberAccountConsoleRecords("org-current", 1);
    assert.deepEqual(current.purchaseIntents, {
      total: 2,
      pendingManualDelivery: 2,
      recent: [{ demandId: "demand-current-new", status: "PENDING_MANUAL_DELIVERY", resourceTitle: "Current New", supplierName: "Supplier Current", estimatedCardHourMicros: 24_000_000, createdAt: "2026-08-19T07:02:00.000Z", updatedAt: "2026-08-19T07:02:00.000Z" }],
    });
    assert.deepEqual(current.supplyApplications, {
      total: 2,
      pendingReview: 1,
      approved: 1,
      verified: 1,
      published: 0,
      needsAttention: 0,
      recent: [{ id: "supply-current-new", productName: "Current H200", resourceType: "GPU_SERVER", status: "UNDER_VERIFICATION", createdAt: "2026-08-19T07:04:00.000Z", updatedAt: "2026-08-19T07:04:00.000Z" }],
    });
    assert.doesNotMatch(JSON.stringify(current), /Other Secret|Unbound Secret/u);
    const other = await admin.getMemberAccountConsoleRecords("org-other", 5);
    assert.equal(other.purchaseIntents.total, 1);
    assert.equal(other.supplyApplications.total, 1);
    assert.equal(other.supplyApplications.approved, 0);
  } finally {
    admin?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
