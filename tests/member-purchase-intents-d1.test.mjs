import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createD1AdminOperationsStore } from "../lib/server/admin-store-d1.ts";

class FakeD1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new FakeD1Statement(this.database, this.sql, values); }
  execute(mode) {
    const statement = this.database.prepare(this.sql);
    if (mode === "first") return statement.get(...this.values) ?? null;
    if (mode === "all") return statement.all(...this.values);
    const result = statement.run(...this.values);
    return { results: [], success: true, meta: { changes: Number(result.changes) } };
  }
  async run() { return this.execute("run"); }
  async all() { return { results: this.execute("all"), success: true, meta: { changes: 0 } }; }
  async first() { return this.execute("first"); }
}

class FakeD1Database {
  constructor() { this.database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true }); }
  prepare(sql) { return new FakeD1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.execute("run"));
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  close() { this.database.close(); }
}

const FINGERPRINT = `SHA256:${"A".repeat(43)}`;
const CANONICAL_KEY = `ssh-ed25519 ${Buffer.concat([
  Buffer.from([0, 0, 0, 11]), Buffer.from("ssh-ed25519"), Buffer.from([0, 0, 0, 32]), Buffer.alloc(32, 7),
]).toString("base64")}`;

test("D1 adapter persists and isolates immutable member compute snapshots", async () => {
  const database = new FakeD1Database();
  const store = await createD1AdminOperationsStore(database);
  const principalId = "buyer-account-d1";
  const demandId = "KAI-R-D1-PURCHASE-SNAPSHOT";
  try {
    await store.bindEntityOrganization({ principalId, organizationId: "buyer-org-d1", idempotencyKey: "d1-ownership-snapshot", payloadHash: "ownership-hash" }, {
      sourceSystem: "MARKETPLACE", entityType: "DEMAND", entityId: demandId, organizationId: "buyer-org-d1", accountId: principalId, expectedVersion: 0, reason: "Bind D1 snapshot to buyer organization.",
    });
    await store.recordManualDeliveryIntake({ principalId, organizationId: "buyer-org-d1", idempotencyKey: "d1-manual-delivery", payloadHash: "manual-delivery-hash" }, {
      demandId, buyerAccountId: principalId, resourceId: "gpu-d1-h200", resourceTitle: "H200 NVL 单卡", canonicalSshPublicKey: CANONICAL_KEY, sshPublicKeyFingerprint: FINGERPRINT,
    });
    const input = {
      demandId,
      buyerAccountId: principalId,
      resourceSnapshot: {
        id: "gpu-d1-h200", title: "H200 NVL 单卡", supplierId: "supplier-d1", supplierName: "D1 Supplier", supplierLogoUrl: null,
        category: "gpu", region: "全国", deliveryForm: "云主机", summary: "H200 NVL 单卡人工交付。", capacity: "询价确认",
        sla: "人工确认", deliveryLeadTime: "人工确认", sourceNotice: "实际机房地域待确认。", gpuDescription: "NVIDIA H200 NVL × 1", gpuPackageCount: 1,
        specs: { GPU: "NVIDIA H200 NVL × 1", 内存: "询价确认" },
      },
      quantity: 2, durationHours: 24, deliveryDate: "2026-09-01", pricingUnit: "卡时", unitPriceCnyCents: 8850,
      unitCardHourMicros: 88_323_354, estimatedCardHourMicros: 4_239_520_958, sshPublicKeyFingerprint: FINGERPRINT,
    };
    const first = await store.recordCatalogPurchaseIntentSnapshot({ principalId, organizationId: "buyer-org-d1", idempotencyKey: "d1-purchase-snapshot", payloadHash: "purchase-snapshot-hash" }, input);
    assert.equal(first.replayed, false);
    assert.equal(first.record.request.totalGpuCount, 2);
    const replay = await store.recordCatalogPurchaseIntentSnapshot({ principalId, organizationId: "buyer-org-d1", idempotencyKey: "d1-purchase-snapshot", payloadHash: "purchase-snapshot-hash" }, input);
    assert.equal(replay.replayed, true);
    assert.equal((await store.listMemberCatalogPurchaseIntents("buyer-org-d1")).length, 1);
    assert.equal(await store.getMemberCatalogPurchaseIntent("other-org", demandId), null);
    const detail = await store.getMemberCatalogPurchaseIntent("buyer-org-d1", demandId);
    assert.equal(detail?.resource.title, "H200 NVL 单卡");
    assert.equal(detail?.sshPublicKeyFingerprint, FINGERPRINT);
    assert.doesNotMatch(JSON.stringify(detail), /ssh-ed25519|buyer-account-d1|buyer-org-d1|payload_hash|idempotency/u);
  } finally { database.close(); }
});
