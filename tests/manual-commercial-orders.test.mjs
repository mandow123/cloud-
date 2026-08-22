import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { cardHourSchemaStatements } from "../db/card-hour-schema.ts";
import { createD1AdminOperationsStore } from "../lib/server/admin-store-d1.ts";
import { createSqliteAdminOperationsStore } from "../lib/server/admin-store-sqlite.ts";
import { manualOrderFlowEnabled } from "../lib/server/manual-order-feature.ts";

class Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.database, this.sql, values); }
  execute(mode) {
    const query = this.database.prepare(this.sql);
    if (mode === "first") return query.get(...this.values) ?? null;
    if (mode === "all") return query.all(...this.values);
    const result = query.run(...this.values);
    return { results: [], success: true, meta: { changes: Number(result.changes) } };
  }
  async run() { return this.execute("run"); }
  async all() { return { results: this.execute("all"), success: true, meta: { changes: 0 } }; }
  async first() { return this.execute("first"); }
}

class D1Database {
  constructor() {
    this.database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
    for (const statement of cardHourSchemaStatements) this.database.exec(statement);
  }
  prepare(sql) { return new Statement(this.database, sql); }
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

const snapshot = {
  id: "gpu-h200", title: "H200 NVL", supplierId: "supplier", supplierName: "供应商", supplierLogoUrl: null,
  category: "gpu", region: "华东", deliveryForm: "人工 SSH", summary: "H200", capacity: "1卡", sla: "人工",
  deliveryLeadTime: "1小时", sourceNotice: null, gpuDescription: "NVIDIA H200 NVL × 1", gpuPackageCount: 1,
  specs: { GPU: "H200" },
};
const context = (principalId, organizationId, idempotencyKey) => ({ principalId, organizationId, idempotencyKey, payloadHash: idempotencyKey });

async function seed(store, raw, key) {
  const buyerAccountId = `buyer-${key}`, buyerOrganizationId = `buyer-org-${key}`,
    supplierOrganizationId = `supplier-org-${key}`, demandId = `demand-${key}`;
  await store.bindEntityOrganization(context(buyerAccountId, buyerOrganizationId, `own-${key}`), {
    sourceSystem: "MARKETPLACE", entityType: "DEMAND", entityId: demandId,
    organizationId: buyerOrganizationId, accountId: buyerAccountId, expectedVersion: 0,
    reason: "Bind buyer demand ownership.",
  });
  await store.recordManualDeliveryIntake(context(buyerAccountId, buyerOrganizationId, `intake-${key}`), {
    demandId, buyerAccountId, resourceId: snapshot.id, resourceTitle: snapshot.title,
    canonicalSshPublicKey: "ssh-ed25519 AAAATEST", sshPublicKeyFingerprint: `SHA256:${"A".repeat(43)}`,
  });
  await store.recordCatalogPurchaseIntentSnapshot(context(buyerAccountId, buyerOrganizationId, `snapshot-${key}`), {
    demandId, buyerAccountId, resourceSnapshot: snapshot, quantity: 1, durationHours: 24,
    deliveryDate: "2026-09-01", pricingUnit: "卡时", unitPriceCnyCents: 10000,
    unitCardHourMicros: 100000000, estimatedCardHourMicros: 100000000,
    sshPublicKeyFingerprint: `SHA256:${"A".repeat(43)}`,
  });
  raw.prepare("UPDATE admin_manual_delivery_statuses SET supplier_organization_id=?,status='SUPPLIER_ASSIGNED',version=2 WHERE demand_id=?").run(supplierOrganizationId, demandId);
  raw.prepare("INSERT INTO card_hour_wallets(organization_id,available_micros,held_micros,lifetime_topup_micros,lifetime_spent_micros,version,created_at,updated_at) VALUES(?,200000000,0,200000000,0,1,?,?)").run(buyerOrganizationId, new Date().toISOString(), new Date().toISOString());
  return { buyerAccountId, buyerOrganizationId, supplierOrganizationId, demandId };
}

async function exercise(store, raw, key) {
  const seeded = await seed(store, raw, key), supplier = `supplier-${key}`;
  const offer = await store.createSupplierManualOrderOffer(context(supplier, seeded.supplierOrganizationId, `offer-${key}`), {
    demandId: seeded.demandId, quotedCardHourMicros: 100000000,
    serviceSummary: "人工交付 H200 24 小时", expectedDeliveryStatusVersion: 2,
  });
  assert.equal(offer.record.status, "OFFERED");
  assert.equal(await store.getSupplierManualOrder("wrong", offer.record.id), null);
  raw.prepare("UPDATE admin_manual_order_fee_tiers SET platform_fee_bps=20 WHERE policy_version='MANUAL-2026-01' AND tier_code='STARTER'").run();
  const accepted = await store.acceptMemberManualOrderOffer(context(seeded.buyerAccountId, seeded.buyerOrganizationId, `accept-${key}`), offer.record.id, { expectedVersion: 1 });
  assert.equal(accepted.record.hold.status, "HELD");
  assert.deepEqual({ ...raw.prepare("SELECT available_micros,held_micros FROM card_hour_wallets WHERE organization_id=?").get(seeded.buyerOrganizationId) }, { available_micros: 100000000, held_micros: 100000000 });
  const preparing = await store.transitionSupplierManualOrder(context(supplier, seeded.supplierOrganizationId, `prepare-${key}`), offer.record.id, "PREPARE", { expectedVersion: 2 });
  raw.prepare("UPDATE admin_manual_delivery_statuses SET status='AWAITING_BUYER_ACCEPTANCE',connection_host='gpu.example.com',connection_port=22022,connection_username='root',connection_host_key_fingerprint=?,version=3 WHERE demand_id=?").run(`SHA256:${"B".repeat(43)}`, seeded.demandId);
  const ready = await store.transitionSupplierManualOrder(context(supplier, seeded.supplierOrganizationId, `ready-${key}`), offer.record.id, "READY", { expectedVersion: preparing.record.version });
  assert.equal(ready.record.delivery.connection, null, "supplier DTO must not expose connection");
  const previousOrderFlag = process.env.KAI_MANUAL_ORDER_FLOW_V1;
  process.env.KAI_MANUAL_ORDER_FLOW_V1 = "1";
  try {
    await assert.rejects(() => store.confirmMemberManualDelivery(context(seeded.buyerAccountId, seeded.buyerOrganizationId, `legacy-confirm-${key}`), seeded.demandId, { expectedVersion: 3 }), /manual commercial order/iu);
  } finally {
    if (previousOrderFlag == null) delete process.env.KAI_MANUAL_ORDER_FLOW_V1;
    else process.env.KAI_MANUAL_ORDER_FLOW_V1 = previousOrderFlag;
  }
  const confirmed = await store.transitionMemberManualOrder(context(seeded.buyerAccountId, seeded.buyerOrganizationId, `connect-${key}`), offer.record.id, "CONFIRM_CONNECTION", { expectedVersion: ready.record.version });
  assert.equal(confirmed.record.delivery.connection.host, "gpu.example.com");
  const ended = await store.transitionSupplierManualOrder(context(supplier, seeded.supplierOrganizationId, `end-${key}`), offer.record.id, "SERVICE_COMPLETE", { expectedVersion: confirmed.record.version, actualCardHourMicros: 80000000 });
  const appeal = await store.createMemberManualAppeal(context(seeded.buyerAccountId, seeded.buyerOrganizationId, `appeal-${key}`), seeded.demandId, { category: "DELIVERY_QUALITY", subject: "服务质量申诉", description: "服务结束前出现连接质量问题，需要先核对。" });
  await assert.rejects(() => store.transitionMemberManualOrder(context(seeded.buyerAccountId, seeded.buyerOrganizationId, `blocked-${key}`), offer.record.id, "ACCEPT_COMPLETION", { expectedVersion: ended.record.version }), /open appeal freezes/iu);
  await assert.rejects(() => store.transitionAdminManualAppeal(context("admin", null, `early-close-${key}`), appeal.record.id, { expectedVersion: 1, action: "CLOSE" }), /not allowed/iu);
  await store.transitionAdminManualAppeal(context("admin", null, `triage-${key}`), appeal.record.id, { expectedVersion: 1, action: "TRIAGE" });
  await store.transitionAdminManualAppeal(context("admin", null, `propose-${key}`), appeal.record.id, { expectedVersion: 2, action: "PROPOSE_RESOLUTION", resolutionOutcome: "NO_ACTION", resolutionSummary: "复核完成，订单可以继续验收。" });
  await store.transitionAdminManualAppeal(context("admin", null, `resolve-${key}`), appeal.record.id, { expectedVersion: 3, action: "RESOLVE" });
  await store.transitionAdminManualAppeal(context("admin", null, `close-${key}`), appeal.record.id, { expectedVersion: 4, action: "CLOSE" });
  const completed = await store.transitionMemberManualOrder(context(seeded.buyerAccountId, seeded.buyerOrganizationId, `complete-${key}`), offer.record.id, "ACCEPT_COMPLETION", { expectedVersion: ended.record.version });
  assert.equal(completed.record.status, "COMPLETED");
  assert.equal(completed.record.hold.capturedMicros, 80000000);
  assert.equal(completed.record.hold.releasedMicros, 20000000);
  const buyerJson = JSON.stringify(await store.getMemberManualOrder(seeded.buyerOrganizationId, offer.record.id));
  assert.doesNotMatch(buyerJson, /platformFee|supplierReceivable|grossCny|payoutStatus/u);
  const supplierCompleted = await store.getSupplierManualOrder(seeded.supplierOrganizationId, offer.record.id);
  assert.equal(supplierCompleted?.settlement.platformFeeBps, 100);
  assert.equal(supplierCompleted?.settlement.payoutStatus, "CLOSED");
  assert.ok((supplierCompleted?.settlement.supplierReceivableCnyCents ?? 0) > 0);
  const adminCompleted = await store.getAdminManualOrder(offer.record.id);
  assert.equal(adminCompleted?.settlement.platformFeeBps, 100);
  assert.equal(raw.prepare("SELECT status FROM admin_manual_delivery_statuses WHERE demand_id=?").get(seeded.demandId).status, "COMPLETED");
  assert.deepEqual({ ...raw.prepare("SELECT available_micros,held_micros,lifetime_spent_micros FROM card_hour_wallets WHERE organization_id=?").get(seeded.buyerOrganizationId) }, { available_micros: 120000000, held_micros: 0, lifetime_spent_micros: 80000000 });
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM card_hour_ledger_batches WHERE business_key=?").get(`order:MANUAL_ORDER_V1:${offer.record.id}`).count, 1);
}

test("manual commercial order closes safely in SQLite", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-mo-")), path = join(directory, "x.sqlite"), raw = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  for (const statement of cardHourSchemaStatements) raw.exec(statement);
  raw.close();
  const store = await createSqliteAdminOperationsStore(path), database = new DatabaseSync(path);
  try { await exercise(store, database, "sqlite"); } finally { database.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("manual commercial order preserves invariants through D1 adapter", async () => {
  const database = new D1Database(), store = await createD1AdminOperationsStore(database);
  try { await exercise(store, database.database, "d1"); } finally { database.close(); }
});

test("manual order is default off, migrations mirror, and payout/provider code is absent", () => {
  assert.equal(manualOrderFlowEnabled({}), false);
  assert.equal(readFileSync(new URL("../drizzle/0035_manual_commercial_orders.sql", import.meta.url), "utf8"), readFileSync(new URL("../.openai/drizzle/0035_manual_commercial_orders.sql", import.meta.url), "utf8"));
  const source = readFileSync(new URL("../lib/server/admin-store-core.ts", import.meta.url), "utf8");
  const helper = source.slice(source.indexOf("async function transitionMemberOrder"), source.indexOf("function purchaseResourceSnapshot"));
  const methods = source.slice(source.indexOf("async createSupplierManualOrderOffer"), source.indexOf("async getMemberAccountConsoleRecords"));
  const slice = helper + methods;
  assert.doesNotMatch(slice, /qixiang|alipay|payoutTrade|refundTrade/iu);
  assert.match(source, /payoutStatus:"CLOSED"/u);
});
