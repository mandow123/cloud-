import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { cardHourSchemaStatements } from "../db/card-hour-schema.ts";
import { hostingV2SchemaStatements } from "../db/hosting-v2-schema.ts";
import { managedGpuSchemaStatements } from "../db/managed-gpu-schema.ts";
import {
  MANAGED_GPU_ASSET_STATUSES,
  MANAGED_GPU_ORDER_STATUSES,
  MANAGED_GPU_SETTLEMENT_STATUSES,
  assertManagedGpuOrderTransition,
  managedGpuNetSettlementMicros,
  requiredManagedGpuAssetEvidence,
} from "../lib/managed-gpu.ts";
import { createManagedGpuStore } from "../lib/server/managed-gpu-store-core.ts";
import { createSqliteCardHourStore } from "../lib/server/card-hour-store-sqlite.ts";
import {
  managedGpuFeatureEnabled,
  managedGpuOrganizationEnabled,
  managedGpuOrganizationInvited,
} from "../lib/server/managed-gpu-feature.ts";
import { createSqliteManagedGpuStore } from "../lib/server/managed-gpu-store-sqlite.ts";

const GROSS_CARD_HOUR_MICROS = 100_000_000;

function expectDomainError(code) {
  return (error) => error?.name === "ManagedGpuDomainError" && error?.code === code;
}

const settlement = (overrides = {}) => ({
  grossCardHourMicros: GROSS_CARD_HOUR_MICROS,
  refundCardHourMicros: 5_000_000,
  platformFeeMicros: 1_000_000,
  wearMicros: 3_000_000,
  facilityChargeMicros: 8_000_000,
  ...overrides,
});

test("managed GPU order state machine rejects payment, fulfillment and terminal-state shortcuts", () => {
  assert.deepEqual(MANAGED_GPU_ORDER_STATUSES, [
    "REQUESTED", "QUOTED", "AWAITING_PAYMENT", "PAID", "PROCUREMENT",
    "ASSET_ASSIGNED", "FULFILLED", "CANCELLED", "DISPUTED", "REFUNDED",
  ]);
  for (const [from, to] of [
    ["REQUESTED", "PAID"], ["AWAITING_PAYMENT", "FULFILLED"],
    ["PAID", "ASSET_ASSIGNED"], ["PROCUREMENT", "FULFILLED"],
    ["FULFILLED", "PAID"], ["CANCELLED", "QUOTED"], ["REFUNDED", "PAID"],
  ]) {
    assert.throws(
      () => assertManagedGpuOrderTransition(from, to),
      expectDomainError("MANAGED_GPU_ORDER_TRANSITION_INVALID"),
    );
  }
});

test("managed GPU assets require evidence for every custody transition", () => {
  assert.deepEqual(MANAGED_GPU_ASSET_STATUSES, [
    "EXPECTED", "RECEIVED", "INSPECTING", "VERIFIED", "INSTALLED", "ACTIVE",
    "MAINTENANCE", "DRAINING", "SHIPPING", "DELIVERED", "RETIRED",
  ]);
  assert.equal(requiredManagedGpuAssetEvidence("EXPECTED", "RECEIVED"), "RECEIPT");
  assert.equal(requiredManagedGpuAssetEvidence("RECEIVED", "INSPECTING"), "INSPECTION_STARTED");
  assert.equal(requiredManagedGpuAssetEvidence("INSPECTING", "VERIFIED"), "VERIFICATION");
  assert.equal(requiredManagedGpuAssetEvidence("VERIFIED", "INSTALLED"), "AGENT_BINDING");
  assert.equal(requiredManagedGpuAssetEvidence("INSTALLED", "ACTIVE"), "AGENT_ONLINE");
  assert.throws(
    () => requiredManagedGpuAssetEvidence("EXPECTED", "ACTIVE"),
    expectDomainError("MANAGED_GPU_ASSET_TRANSITION_INVALID"),
  );
  for (const forbidden of ["TRANSFERRED", "WITHDRAWABLE", "TOKENIZED"]) {
    assert.equal(MANAGED_GPU_ASSET_STATUSES.includes(forbidden), false);
  }
});

test("managed GPU settlement uses exact card-hour micros, never fiat owner payable", () => {
  assert.deepEqual(managedGpuNetSettlementMicros(settlement()), {
    grossCardHourMicros: GROSS_CARD_HOUR_MICROS,
    refundCardHourMicros: 5_000_000,
    earnedCardHourMicros: 95_000_000,
    totalChargeMicros: 12_000_000,
    appliedDeductionMicros: 12_000_000,
    shortfallMicros: 0,
    netCardHourMicros: 83_000_000,
  });
  assert.deepEqual(managedGpuNetSettlementMicros(settlement({
    grossCardHourMicros: Number.MAX_SAFE_INTEGER,
    refundCardHourMicros: Number.MAX_SAFE_INTEGER,
    platformFeeMicros: 0,
    wearMicros: 0,
    facilityChargeMicros: 0,
  })), {
    grossCardHourMicros: Number.MAX_SAFE_INTEGER,
    refundCardHourMicros: Number.MAX_SAFE_INTEGER,
    earnedCardHourMicros: 0,
    totalChargeMicros: 0,
    appliedDeductionMicros: 0,
    shortfallMicros: 0,
    netCardHourMicros: 0,
  });
});

test("managed GPU settlement rejects negative, fractional and overflowing card-hour values", () => {
  for (const input of [
    settlement({ grossCardHourMicros: -1 }),
    settlement({ grossCardHourMicros: 100.25 }),
    settlement({ grossCardHourMicros: Number.MAX_SAFE_INTEGER + 1 }),
    settlement({ platformFeeMicros: -1 }),
    settlement({ wearMicros: Number.NaN }),
  ]) {
    assert.throws(
      () => managedGpuNetSettlementMicros(input),
      expectDomainError("MANAGED_GPU_CARD_HOUR_MICROS_INVALID"),
    );
  }
  assert.deepEqual(managedGpuNetSettlementMicros(settlement({ grossCardHourMicros: 10_000_000, refundCardHourMicros: 5_000_000 })), {
    grossCardHourMicros: 10_000_000,
    refundCardHourMicros: 5_000_000,
    earnedCardHourMicros: 5_000_000,
    totalChargeMicros: 12_000_000,
    appliedDeductionMicros: 5_000_000,
    shortfallMicros: 7_000_000,
    netCardHourMicros: 0,
  });
  assert.throws(
    () => managedGpuNetSettlementMicros(settlement({ grossCardHourMicros: 4_999_999, refundCardHourMicros: 5_000_000 })),
    expectDomainError("MANAGED_GPU_SALES_RECONCILIATION_MISMATCH"),
  );
  assert.throws(
    () => managedGpuNetSettlementMicros(settlement({
      grossCardHourMicros: Number.MAX_SAFE_INTEGER,
      refundCardHourMicros: 0,
      platformFeeMicros: Number.MAX_SAFE_INTEGER,
      wearMicros: 1,
      facilityChargeMicros: 0,
    })),
    expectDomainError("MANAGED_GPU_CARD_HOUR_MICROS_INVALID"),
  );
});

test("managed GPU settlement lifecycle cannot become payable or paid", () => {
  assert.deepEqual(
    MANAGED_GPU_SETTLEMENT_STATUSES.slice(MANAGED_GPU_SETTLEMENT_STATUSES.indexOf("REVIEW_REQUIRED")),
    ["REVIEW_REQUIRED", "READY", "APPROVED", "POSTED", "REVERSED"],
  );
  assert.ok(MANAGED_GPU_SETTLEMENT_STATUSES.indexOf("APPROVED") < MANAGED_GPU_SETTLEMENT_STATUSES.indexOf("POSTED"));
  for (const forbidden of ["WITHDRAWABLE", "TRANSFERABLE", "PAYABLE", "PAID"]) {
    assert.equal(MANAGED_GPU_SETTLEMENT_STATUSES.includes(forbidden), false);
  }
});

test("managed GPU operating-income schema and APIs are card-hour-only", () => {
  const schemaSource = readFileSync(new URL("../db/managed-gpu-schema.ts", import.meta.url), "utf8");
  const storeSource = readFileSync(new URL("../lib/server/managed-gpu-store-core.ts", import.meta.url), "utf8");
  const memberRoute = readFileSync(new URL("../app/api/v1/member/managed-gpu/settlements/route.ts", import.meta.url), "utf8");
  const adminRoute = readFileSync(new URL("../app/api/v1/admin/managed-gpu/settlements/route.ts", import.meta.url), "utf8");
  const settlementTable = schemaSource.match(/CREATE TABLE IF NOT EXISTS managed_gpu_settlements[\s\S]*?\n  \)`/u)?.[0] ?? "";

  assert.ok(settlementTable);
  assert.match(settlementTable, /gross_card_hour_micros/u);
  assert.match(settlementTable, /net_card_hour_micros/u);
  assert.match(`${schemaSource}\n${storeSource}`, /MANAGED_GPU_INCOME/u);
  assert.doesNotMatch(settlementTable, /\bcurrency\b|net_owner_payable|gross_sales_minor|\bPAYABLE\b|\bPAID\b/iu);
  assert.doesNotMatch(`${schemaSource}\n${storeSource}`, /managed_gpu_(?:payout|withdraw|transfer)/iu);
  assert.doesNotMatch(
    `${storeSource}\n${memberRoute}\n${adminRoute}`,
    /OWNER_PAYABLE|netOwnerPayable|payableByCurrency|grossSalesMinor|managedGpuCurrency\(input,\s*"currency"\)/u,
  );
});

function createDatabase(path = ":memory:") {
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  database.exec(cardHourSchemaStatements.join(";\n"));
  database.exec(hostingV2SchemaStatements.join(";\n"));
  database.exec(managedGpuSchemaStatements.join(";\n"));
  return database;
}

function seedDirectAsset(database) {
  const now = "2026-08-26T00:00:00.000Z";
  database.prepare(`INSERT INTO managed_gpu_quotes(
    id,organization_id,account_id,product_version_id,facility_id,quantity,fulfillment_choice,
    requested_currency,destination_country_code,status,unit_amount_minor,total_amount_minor,
    issued_currency,price_breakdown_json,expires_at,idempotency_key,payload_hash,version,created_at,updated_at)
    VALUES(?,?,?,?,?,1,'BEIDOU_HOSTING','CNY',NULL,'ISSUED',5000000,5000000,'CNY','{}',?,
      'risk-quote-key','risk-quote-hash',1,?,?)`).run(
    "mgq_risk", "org-owner", "acct-owner", "MGPU-PV-RTX5090-REFERENCE", "MGPU-FAC-BEIDOU-REFERENCE",
    "2026-08-27T00:00:00.000Z", now, now,
  );
  database.prepare(`INSERT INTO managed_gpu_purchase_orders(
    id,quote_id,organization_id,account_id,product_version_id,facility_id,quantity,fulfillment_choice,
    currency,total_amount_minor,status,idempotency_key,payload_hash,version,created_at,updated_at)
    VALUES('mgo_risk','mgq_risk','org-owner','acct-owner','MGPU-PV-RTX5090-REFERENCE',
      'MGPU-FAC-BEIDOU-REFERENCE',1,'BEIDOU_HOSTING','CNY',5000000,'ASSET_ASSIGNED',
      'risk-order-key','risk-order-hash',1,?,?)`).run(now, now);
  database.prepare(`INSERT INTO managed_gpu_physical_assets(
    id,order_id,unit_index,owner_organization_id,product_version_id,facility_id,serial_fingerprint,
    acquisition_amount_minor,currency,ownership_bps,agent_binding_id,status,version,created_at,updated_at)
    VALUES('mga_risk','mgo_risk',1,'org-owner','MGPU-PV-RTX5090-REFERENCE','MGPU-FAC-BEIDOU-REFERENCE',
      'sha256:risk-serial',5000000,'CNY',10000,'agent-risk','ACTIVE',1,?,?)`).run(now, now);
  database.prepare(`INSERT INTO managed_gpu_economic_policy_versions(
    id,policy_code,version_number,facility_id,facility_charge_micros_per_asset_day,
    platform_fee_bps,wear_reserve_bps,calculation_json,effective_from,effective_until,
    approved_by,immutable_hash,created_at)
    VALUES('mgp_risk','RISK_POLICY',1,'MGPU-FAC-BEIDOU-REFERENCE',8000000,100,200,
      '{}',?,NULL,'risk-approver','sha256:risk-policy',?)`).run(now, now);
}

test("managed GPU schema forbids fractional ownership and duplicate physical identity", () => {
  const database = createDatabase();
  try {
    seedDirectAsset(database);
    assert.throws(() => database.prepare(`INSERT INTO managed_gpu_physical_assets(
      id,order_id,unit_index,owner_organization_id,product_version_id,facility_id,serial_fingerprint,
      acquisition_amount_minor,currency,ownership_bps,status,version,created_at,updated_at)
      SELECT 'mga_fractional',order_id,2,owner_organization_id,product_version_id,facility_id,
        'sha256:fractional',acquisition_amount_minor,currency,5000,status,1,created_at,updated_at
      FROM managed_gpu_physical_assets WHERE id='mga_risk'`).run(), /CHECK constraint failed/u);
    assert.throws(() => database.prepare(`INSERT INTO managed_gpu_physical_assets(
      id,order_id,unit_index,owner_organization_id,product_version_id,facility_id,serial_fingerprint,
      acquisition_amount_minor,currency,ownership_bps,status,version,created_at,updated_at)
      SELECT 'mga_duplicate',order_id,2,owner_organization_id,product_version_id,facility_id,
        serial_fingerprint,acquisition_amount_minor,currency,10000,status,1,created_at,updated_at
      FROM managed_gpu_physical_assets WHERE id='mga_risk'`).run(), /UNIQUE constraint failed/u);
  } finally {
    database.close();
  }
});

test("compute-sale and card-hour settlement evidence is immutable", () => {
  const database = createDatabase();
  try {
    seedDirectAsset(database);
    database.prepare(`INSERT INTO managed_gpu_compute_sale_events(
      id,asset_id,hosting_contract_id,acceptance_event_id,capture_batch_id,event_type,
      accepted_gpu_seconds,card_hour_micros,source_entry_kind,source_entry_status,
      payload_digest,occurred_at,recorded_at)
      VALUES('mgse_risk','mga_risk','hosting-1','acceptance-1','capture-1','CAPTURED',3600,100000000,
        'MANAGED_GPU_INCOME','POSTED','sha256:sale-event','2026-08-26T01:01:00.000Z',
        '2026-08-26T01:01:01.000Z')`).run();
    assert.throws(
      () => database.prepare("UPDATE managed_gpu_compute_sale_events SET card_hour_micros=1 WHERE id='mgse_risk'").run(),
      /immutable/u,
    );
    database.prepare(`INSERT INTO managed_gpu_settlements(
      id,organization_id,asset_id,period_start,period_end,gross_card_hour_micros,
      refund_card_hour_micros,platform_fee_micros,wear_micros,facility_charge_micros,
      earned_card_hour_micros,total_charge_micros,applied_deduction_micros,shortfall_micros,
      net_card_hour_micros,policy_version_id,fee_policy_version_id,fee_tier_code,
      platform_fee_bps,wear_reserve_bps,status,ledger_entry_id,source_key,created_at)
      VALUES('mgst_risk','org-owner','mga_risk','2026-08-26T00:00:00.000Z','2026-08-27T00:00:00.000Z',
        100000000,5000000,1000000,5000000,8000000,95000000,14000000,14000000,0,
        81000000,'mgp_risk','MGPU-FEE-2026-01','STARTER',100,500,
        'REVIEW_REQUIRED',NULL,'source-risk-1','2026-08-27T00:01:00.000Z')`).run();
    assert.throws(
      () => database.prepare("UPDATE managed_gpu_settlements SET net_card_hour_micros=1 WHERE id='mgst_risk'").run(),
      /immutable/u,
    );
  } finally {
    database.close();
  }
});

test("reference inventory and unverified Beidou facility fail closed", () => {
  const database = createDatabase();
  try {
    const products = database.prepare("SELECT sku,sellable,status FROM managed_gpu_product_versions ORDER BY sku").all().map((row) => ({ ...row }));
    assert.deepEqual(products, [
      { sku: "RTX5090-REFERENCE", sellable: 0, status: "ACTIVE" },
      { sku: "RTX6000-REFERENCE", sellable: 0, status: "ACTIVE" },
    ]);
    assert.deepEqual({ ...database.prepare("SELECT code,status,custody_terms_version FROM managed_gpu_facilities").get() }, {
      code: "BEIDOU_REFERENCE", status: "PLANNED", custody_terms_version: "PENDING",
    });
  } finally {
    database.close();
  }
});

function mutation(organizationId, accountId, idempotencyKey, payloadHash, now = "2026-08-26T08:00:00.000Z") {
  return { organizationId, accountId, idempotencyKey, payloadHash, now };
}

async function approvedContext(store, requester, actionType, targetId, nonce, options = {}) {
  const commandPayloadHash = String((nonce.charCodeAt(0) % 9) + 1).repeat(64);
  const now = options.now ?? "2026-08-26T08:00:00.000Z";
  const approverAccountId = options.approverAccountId ?? "acct-managed-second-admin";
  const requested = await store.requestApproval(
    mutation(requester.organizationId, requester.accountId, `approval-request-${nonce}`, `approval-request-hash-${nonce}`, now),
    { actionType, targetId, commandPayloadHash, commandPayload: { actionType, targetId, testNonce: nonce } },
  );
  await store.approveApproval(
    mutation(requester.organizationId, approverAccountId, `approval-decide-${nonce}`, `approval-decide-hash-${nonce}`, now),
    requested.record.id,
    { expectedVersion: 1, actionType },
  );
  return {
    ...mutation(requester.organizationId, requester.accountId, `command-${nonce}`, commandPayloadHash, now),
    approvalId: requested.record.id,
  };
}

function initializeStoreDatabase(path) {
  const database = createDatabase(path);
  database.close();
}

function seedSellableProduct(path) {
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  const now = "2026-08-26T00:00:00.000Z";
  try {
    database.prepare(`INSERT INTO managed_gpu_product_versions(
      id,hardware_class_id,sku,manufacturer,model,display_name,seller_name,gpu_model,hardware_tier,vram_gb,
      specs_json,quote_mode,sellable,currency,unit_price_minor,card_hour_reference_micros,
      warranty_months,estimated_delivery_days,fulfillment_modes_json,facility_ids_json,
      utilization_7d_bps,utilization_30d_bps,quote_valid_until,status,immutable_hash,created_at)
      VALUES('MGPU-PV-RISK-SELLABLE','NVIDIA_RTX_6000','RISK-SELLABLE','NVIDIA','RTX 6000 Ada',
        'Risk-test RTX 6000 Ada','Verified supplier','RTX 6000 Ada','WORKSTATION',48,
        '{"inventory":"VERIFIED","verifiedInventoryCount":100,"inventoryEvidenceDigest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}',
        'QUOTE_REQUIRED',1,'CNY',5000000,5000000,36,30,'["BEIDOU_HOSTING","GLOBAL_SHIPPING"]',
        '["MGPU-FAC-RISK-ACTIVE"]',7000,6500,'2026-08-27T00:00:00.000Z','ACTIVE',
        'managed-gpu:risk:sellable:v2',?)`).run(now);
    database.prepare(`INSERT INTO managed_gpu_facilities(
      id,code,display_name,country_code,region,timezone,status,custody_terms_version,created_at,updated_at,version)
      VALUES('MGPU-FAC-RISK-ACTIVE','RISK_ACTIVE','Risk-test Beidou','CN','上海','Asia/Shanghai',
        'ACTIVE','RISK_TERMS_V1',?,?,1)`).run(now, now);
    database.prepare(`INSERT INTO managed_gpu_economic_policy_versions(
      id,policy_code,version_number,facility_id,facility_charge_micros_per_asset_day,
      platform_fee_bps,wear_reserve_bps,calculation_json,effective_from,effective_until,
      approved_by,immutable_hash,created_at)
      VALUES('MGPU-POLICY-RISK','RISK_ACTUAL_SALES',1,'MGPU-FAC-RISK-ACTIVE',8000000,100,200,
        '{"basis":"ACTUAL_POSTED_CARD_HOURS_ONLY"}','2026-08-01T00:00:00.000Z',NULL,
        'risk-four-eyes-approver','managed-gpu:risk:policy:v2',?)`).run(now);
  } finally {
    database.close();
  }
}

async function createOwnedFixture(path, options = {}) {
  initializeStoreDatabase(path);
  const store = await createSqliteManagedGpuStore(path);
  seedSellableProduct(path);
  const owner = { organizationId: "org-managed-owner", accountId: "acct-managed-owner" };
  const admin = { organizationId: "org-managed-admin", accountId: "acct-managed-admin" };
  const fulfillmentChoice = options.fulfillmentChoice ?? "BEIDOU_HOSTING";
  const facilityId = fulfillmentChoice === "BEIDOU_HOSTING" ? "MGPU-FAC-RISK-ACTIVE" : null;
  const quote = await store.createQuote(mutation(owner.organizationId, owner.accountId, "quote-risk", "quote-risk-hash"), {
    productVersionId: "MGPU-PV-RISK-SELLABLE", facilityId, quantity: 2,
    fulfillmentChoice, requestedCurrency: "CNY", destinationCountryCode: fulfillmentChoice === "GLOBAL_SHIPPING" ? "US" : null,
  });
  const issued = await store.issueQuote(
    await approvedContext(store, admin, "ISSUE_QUOTE", quote.record.id, "issue"), quote.record.id,
    { expectedVersion: 1, unitAmountMinor: 5_000_000, shippingMinor: 0, taxMinor: 0, otherMinor: 0, currency: "CNY", expiresAt: "2026-08-27T08:00:00.000Z" },
  );
  const order = await store.acceptQuote(
    mutation(owner.organizationId, owner.accountId, "accept-risk", "accept-risk-hash"), issued.record.id,
  );
  await store.recordPaymentEvidence(
    await approvedContext(store, admin, "RECORD_PAYMENT_EVIDENCE", order.record.id, "payment"),
    { orderId: order.record.id, provider: "RISK_PAY", providerReference: "risk-payment-1", eventType: "CAPTURED", amountMinor: 10_000_000, currency: "CNY", payloadDigest: "c".repeat(64), occurredAt: "2026-08-26T07:59:00.000Z" },
  );
  const paid = await store.transitionOrder(
    await approvedContext(store, admin, "TRANSITION_ORDER", order.record.id, "paid"),
    order.record.id, { expectedVersion: 1, toStatus: "PAID" },
  );
  await store.transitionOrder(
    await approvedContext(store, admin, "TRANSITION_ORDER", order.record.id, "procurement"),
    order.record.id, { expectedVersion: paid.record.version, toStatus: "PROCUREMENT" },
  );
  const asset = await store.createAsset(
    await approvedContext(store, admin, "CREATE_ASSET", order.record.id, "asset"),
    { orderId: order.record.id, unitIndex: 1, serialFingerprint: "a".repeat(64), facilityId, status: "EXPECTED" },
  );
  return { store, owner, admin, quote, order, asset };
}

async function createUnissuedQuoteFixture(path) {
  initializeStoreDatabase(path);
  const store = await createSqliteManagedGpuStore(path);
  seedSellableProduct(path);
  const owner = { organizationId: "org-managed-owner", accountId: "acct-managed-owner" };
  const admin = { organizationId: "org-managed-admin", accountId: "acct-managed-admin" };
  const quote = await store.createQuote(
    mutation(owner.organizationId, owner.accountId, "quote-approval-risk", "quote-approval-risk-hash"),
    {
      productVersionId: "MGPU-PV-RISK-SELLABLE", facilityId: "MGPU-FAC-RISK-ACTIVE", quantity: 1,
      fulfillmentChoice: "BEIDOU_HOSTING", requestedCurrency: "CNY", destinationCountryCode: null,
    },
  );
  return { store, admin, quote };
}

async function createRacingManagedGpuStore(path, raceKind = "quote") {
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  let raceInjected = false;
  const values = (items = []) => items;
  const adapter = {
    async first(sql, items = []) { return database.prepare(sql).get(...values(items)) ?? null; },
    async all(sql, items = []) { return database.prepare(sql).all(...values(items)); },
    async run(sql, items = []) { return { changes: Number(database.prepare(sql).run(...values(items)).changes) }; },
    async batch(statements) {
      if (raceKind === "quote" && !raceInjected && statements.some((item) => item.sql.includes("UPDATE managed_gpu_quotes SET status='ISSUED'"))) {
        database.prepare("UPDATE managed_gpu_quotes SET version=99 WHERE status='REQUESTED'").run();
        raceInjected = true;
      }
      if (raceKind === "settlement-post" && !raceInjected && statements.some((item) => item.sql.includes("'MANAGED_GPU_INCOME'"))) {
        const source = database.prepare("SELECT settlement_id,sequence FROM managed_gpu_settlement_events ORDER BY sequence DESC LIMIT 1").get();
        database.prepare(`INSERT INTO managed_gpu_settlement_events(
          id,settlement_id,sequence,status,requested_by,approved_by,approval_id,ledger_batch_id,payload_digest,occurred_at)
          VALUES('mgse_competing',?,?,'REVERSED','acct-race-requester','acct-race-approver','approval-race',NULL,?,'2026-08-26T08:00:00.000Z')`).run(
          source.settlement_id, Number(source.sequence) + 1, "9".repeat(64),
        );
        raceInjected = true;
      }
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((item) => {
          const result = { changes: Number(database.prepare(item.sql).run(...values(item.values)).changes) };
          if (item.expectedChanges != null && result.changes !== item.expectedChanges) {
            const error = new Error("MANAGED_GPU_ATOMIC_CHANGE_CONFLICT");
            error.code = "MANAGED_GPU_ATOMIC_CHANGE_CONFLICT";
            throw error;
          }
          return result;
        });
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    async ensureSchema(statements, version) {
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const sql of statements) database.exec(sql);
        database.prepare("INSERT OR IGNORE INTO managed_gpu_schema_migrations(version,applied_at) VALUES(?,?)").run(version, new Date().toISOString());
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { database, store: await createManagedGpuStore(adapter) };
}

test("approved commands can only be consumed by the original requesting administrator and organization", async () => {
  for (const [label, override] of [
    ["different-account", { accountId: "acct-managed-third-admin" }],
    ["different-organization", { organizationId: "org-managed-attacker", accountId: "acct-managed-attacker" }],
  ]) {
    const directory = mkdtempSync(join(tmpdir(), `kai-managed-gpu-risk-approval-${label}-`));
    const path = join(directory, "managed-gpu.sqlite");
    try {
      const { store, admin, quote } = await createUnissuedQuoteFixture(path);
      const approved = await approvedContext(store, admin, "ISSUE_QUOTE", quote.record.id, `executor-${label}`);
      await assert.rejects(
        store.issueQuote(
          { ...approved, ...override },
          quote.record.id,
          { expectedVersion: 1, unitAmountMinor: 5_000_000, shippingMinor: 0, taxMinor: 0, otherMinor: 0, currency: "CNY", expiresAt: "2026-08-27T08:00:00.000Z" },
        ),
        (error) => ["MANAGED_GPU_APPROVAL_INVALID", "MANAGED_GPU_APPROVAL_CONTEXT_MISMATCH"].includes(error?.code),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("a failed business mutation does not permanently consume its approval", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-approval-atomic-"));
  const path = join(directory, "managed-gpu.sqlite");
  try {
    const { store, admin, quote } = await createUnissuedQuoteFixture(path);
    const approved = await approvedContext(store, admin, "ISSUE_QUOTE", quote.record.id, "atomic-failure");
    await assert.rejects(
      store.issueQuote(
        approved,
        quote.record.id,
        { expectedVersion: 1, unitAmountMinor: 0, shippingMinor: 0, taxMinor: 0, otherMinor: 0, currency: "CNY", expiresAt: "2026-08-27T08:00:00.000Z" },
      ),
      (error) => error?.code === "MANAGED_GPU_VALIDATION_ERROR",
    );
    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      assert.equal(
        database.prepare("SELECT status FROM managed_gpu_approvals WHERE id=?").get(approved.approvalId)?.status,
        "APPROVED",
        "approval consumption and business mutation must commit or roll back together",
      );
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an optimistic-lock race rolls back approval consumption, receipt and audit event", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-approval-race-"));
  const path = join(directory, "managed-gpu.sqlite");
  let database;
  try {
    initializeStoreDatabase(path);
    seedSellableProduct(path);
    const racing = await createRacingManagedGpuStore(path);
    database = racing.database;
    const store = racing.store;
    const owner = { organizationId: "org-managed-owner", accountId: "acct-managed-owner" };
    const admin = { organizationId: "org-managed-admin", accountId: "acct-managed-admin" };
    const quote = await store.createQuote(
      mutation(owner.organizationId, owner.accountId, "quote-race-risk", "quote-race-risk-hash"),
      { productVersionId: "MGPU-PV-RISK-SELLABLE", facilityId: "MGPU-FAC-RISK-ACTIVE", quantity: 1, fulfillmentChoice: "BEIDOU_HOSTING", requestedCurrency: "CNY", destinationCountryCode: null },
    );
    const approved = await approvedContext(store, admin, "ISSUE_QUOTE", quote.record.id, "optimistic-race");
    await assert.rejects(
      store.issueQuote(
        approved,
        quote.record.id,
        { expectedVersion: 1, unitAmountMinor: 5_000_000, shippingMinor: 0, taxMinor: 0, otherMinor: 0, currency: "CNY", expiresAt: "2026-08-27T08:00:00.000Z" },
      ),
    );
    assert.equal(database.prepare("SELECT status FROM managed_gpu_approvals WHERE id=?").get(approved.approvalId)?.status, "APPROVED");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM managed_gpu_command_receipts WHERE command_scope='ISSUE_QUOTE'").get()?.count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM managed_gpu_domain_events WHERE entity_id=? AND event_type='QUOTE_ISSUED'").get(quote.record.id)?.count, 0);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("payment evidence gates paid state and assets cannot skip initial evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-payment-"));
  const path = join(directory, "managed-gpu.sqlite");
  try {
    const fixture = await createOwnedFixture(path);
    await assert.rejects(
      fixture.store.createAsset(
        await approvedContext(fixture.store, fixture.admin, "CREATE_ASSET", fixture.order.record.id, "asset-skip"),
        { orderId: fixture.order.record.id, unitIndex: 2, serialFingerprint: "b".repeat(64), facilityId: "MGPU-FAC-RISK-ACTIVE", status: "ACTIVE" },
      ),
      (error) => error?.code === "MANAGED_GPU_VALIDATION_ERROR",
    );
    assert.equal((await fixture.store.memberSummary(fixture.owner.organizationId)).activeAssetCount, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("asset transitions persist evidence and reject custody shortcuts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-evidence-"));
  const path = join(directory, "managed-gpu.sqlite");
  try {
    const { store, admin, asset } = await createOwnedFixture(path);
    await assert.rejects(
      store.transitionAsset(
        await approvedContext(store, admin, "TRANSITION_ASSET", asset.record.id, "asset-online-skip"),
        asset.record.id,
        { expectedVersion: 1, toStatus: "ACTIVE", evidenceDigest: "d".repeat(64), agentBindingId: "agent-risk" },
      ),
      (error) => error?.code === "MANAGED_GPU_VALIDATION_ERROR",
    );
    let current = asset.record;
    for (const [index, toStatus, agentBindingId] of [
      [1, "RECEIVED", null], [2, "INSPECTING", null], [3, "VERIFIED", null],
      [4, "INSTALLED", "agent-risk"], [5, "ACTIVE", "agent-risk"],
    ]) {
      const result = await store.transitionAsset(
        await approvedContext(store, admin, "TRANSITION_ASSET", asset.record.id, `asset-step-${index}`),
        asset.record.id,
        { expectedVersion: current.version, toStatus, evidenceDigest: String(index).repeat(64), agentBindingId },
      );
      current = result.record;
    }
    assert.equal(current.status, "ACTIVE");
    assert.equal(current.agentBindingId, "agent-risk");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("member data and manual service requests are organization-isolated and idempotent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-isolation-"));
  const path = join(directory, "managed-gpu.sqlite");
  try {
    const { store, owner, quote, order, asset } = await createOwnedFixture(path);
    assert.equal((await store.listMemberQuotes(owner.organizationId)).length, 1);
    assert.equal((await store.listMemberQuotes("org-attacker")).length, 0);
    assert.equal(await store.getMemberOrder("org-attacker", order.record.id), null);
    assert.equal((await store.listMemberAssets("org-attacker")).length, 0);
    assert.equal(asset.record.ownerOrganizationId, owner.organizationId);
    assert.equal(quote.record.organizationId, owner.organizationId);
    assert.deepEqual(await store.memberSummary("org-attacker"), {
      orderCount: 0, assetCount: 0, activeAssetCount: 0, settlementCount: 0,
      confirmedIncomeCardHourMicros: 0, provisionalIncomeCardHourMicros: 0,
      withdrawable: false, transferable: false,
    });
    const context = mutation(owner.organizationId, owner.accountId, "exit-risk", "exit-risk-hash");
    const input = { assetId: asset.record.id, requestType: "EXIT_HOSTING", destinationCountryCode: null, addressReference: null, reason: "Manual compliance review." };
    const first = await store.createServiceRequest(context, input);
    const replay = await store.createServiceRequest(context, input);
    assert.equal(first.record.status, "REQUESTED");
    assert.equal(replay.replayed, true);
    await assert.rejects(
      store.createServiceRequest(mutation("org-attacker", "acct-attacker", "steal-risk", "steal-risk-hash"), input),
      (error) => error?.code === "MANAGED_GPU_NOT_FOUND",
    );
    for (const method of ["transferAsset", "withdrawAsset", "withdrawSettlement", "createPayout", "tradeIncome"]) {
      assert.equal(method in store, false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function recordRealComputeSale(path, assetId, amountMicros = GROSS_CARD_HOUR_MICROS, suffix = "1") {
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try {
    database.prepare(`INSERT INTO card_hour_ledger_batches(
      id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at)
      VALUES(?,?,?,?,?,
        'POSTED','{"sourceSystem":"HOSTING_V2","orderId":"compute-order-1"}',
        '2026-08-26T01:00:59.000Z')`).run(
      `capture-managed-income-${suffix}`, "org-buyer", "ORDER_CAPTURE", `managed-income-order-${suffix}`, amountMicros,
    );
    database.prepare(`INSERT INTO managed_gpu_compute_sale_events(
      id,asset_id,hosting_contract_id,acceptance_event_id,capture_batch_id,event_type,
      accepted_gpu_seconds,card_hour_micros,source_entry_kind,source_entry_status,
      payload_digest,occurred_at,recorded_at)
      VALUES(?,?,?,? ,?,
        'CAPTURED',3600,?,'MANAGED_GPU_INCOME','POSTED','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        '2026-08-26T01:01:00.000Z','2026-08-26T01:01:01.000Z')`).run(
      `mgse_store_risk_${suffix}`, assetId, `hosting-contract-${suffix}`, `acceptance-${suffix}`,
      `capture-managed-income-${suffix}`, amountMicros,
    );
  } finally {
    database.close();
  }
}

async function activateAsset(store, admin, initialAsset, now = "2026-08-26T08:00:00.000Z") {
  let current = initialAsset;
  for (const [index, toStatus, agentBindingId] of [
    [1, "RECEIVED", null], [2, "INSPECTING", null], [3, "VERIFIED", null],
    [4, "INSTALLED", "agent-risk"], [5, "ACTIVE", "agent-risk"],
  ]) {
    current = (await store.transitionAsset(
      await approvedContext(store, admin, "TRANSITION_ASSET", initialAsset.id, `activate-${index}`, { now }),
      initialAsset.id,
      { expectedVersion: current.version, toStatus, evidenceDigest: String(index).repeat(64), agentBindingId },
    )).record;
  }
  return current;
}

async function createSettlementFixture(path, amountMicros = GROSS_CARD_HOUR_MICROS, suffix = "lifecycle") {
  const fixture = await createOwnedFixture(path);
  recordRealComputeSale(path, fixture.asset.record.id, amountMicros, suffix);
  const created = await fixture.store.createSettlement(
    await approvedContext(fixture.store, fixture.admin, "CREATE_SETTLEMENT", fixture.asset.record.id, `create-${suffix}`),
    {
      assetId: fixture.asset.record.id,
      periodStart: "2026-08-26T00:00:00.000Z",
      periodEnd: "2026-08-27T00:00:00.000Z",
      policyVersionId: "MGPU-POLICY-RISK",
      sourceKey: `actual-posted-card-hours-${suffix}`,
    },
  );
  return { ...fixture, settlement: created.record };
}

function managedGpuBuyerAccount(label) {
  return {
    account: { id: `acct-${label}`, displayName: label, primaryEmail: null, status: "ACTIVE" },
    activeOrganization: { id: `org-${label}`, name: label, externalKey: label.toUpperCase(), status: "ACTIVE" },
    membership: { id: `mbr-${label}`, accountId: `acct-${label}`, organizationId: `org-${label}`, status: "ACTIVE", roles: [] },
    sessionId: `session-${label}`,
    authMethod: "EMAIL_OTP",
  };
}

async function createManagedHostingBridgeFixture(path, suffix, options = {}) {
  const fixture = await createOwnedFixture(path);
  const active = await activateAsset(fixture.store, fixture.admin, fixture.asset.record);
  const cardHours = await createSqliteCardHourStore(path);
  const buyer = managedGpuBuyerAccount(`managed-bridge-buyer-${suffix}`);
  const contractId = `hosting-managed-bridge-${suffix}`;
  const supplierOrganizationId = options.supplierOrganizationId ?? fixture.owner.organizationId;
  const grant = await cardHours.requestTrialGrant({
    organizationId: buyer.activeOrganization.id,
    amountMicros: 20_000_000,
    reason: "Managed GPU bridge integration test",
    requestedBy: `admin-bridge-requester-${suffix}`,
    idempotencyKey: `bridge-grant-${suffix}`,
    payloadHash: `bridge-grant-hash-${suffix}`,
    now: "2026-08-26T07:00:00.000Z",
  });
  await cardHours.decideTrialGrant({
    grantId: grant.id,
    decision: "APPROVE",
    approvedBy: `admin-bridge-approver-${suffix}`,
    payloadHash: `bridge-grant-approval-${suffix}`,
    now: "2026-08-26T07:00:01.000Z",
  });
  await cardHours.holdHostingOrder({
    account: buyer,
    orderId: contractId,
    amountMicros: 20_000_000,
    idempotencyKey: `bridge-hold-${suffix}`,
    payloadHash: `bridge-hold-hash-${suffix}`,
    now: "2026-08-26T08:00:00.000Z",
  });
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try {
    const snapshot = {
      title: "Managed GPU bridge",
      gpuModel: "RTX 6000 Ada",
      region: "上海",
      cardHourMicrosPerGpuHour: 20_000_000,
      approvedImage: `ghcr.io/kai-cloud/cuda-pytorch@sha256:${"a".repeat(64)}`,
      termsVersion: "KAI_HOSTING_TERMS_2026_08",
      platformFeeBps: 100,
      referralRewardBps: 0,
      acceptanceWindowSeconds: 1_800,
    };
    database.prepare(`INSERT INTO hosting_v2_contracts(
      id,offer_id,device_id,buyer_organization_id,buyer_account_id,supplier_organization_id,
      fee_schedule_id,snapshot_json,reserved_seconds,measured_seconds,held_micros,status,stopped_at,
      idempotency_key,payload_hash,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      contractId, `offer-managed-bridge-${suffix}`, options.deviceId ?? active.agentBindingId,
      buyer.activeOrganization.id, buyer.account.id, supplierOrganizationId,
      `fee-managed-bridge-${suffix}`, JSON.stringify(snapshot), 3_600, 3_600, 20_000_000,
      "AWAITING_ACCEPTANCE", "2026-08-26T09:00:00.000Z", `seed-bridge-${suffix}`,
      `seed-bridge-hash-${suffix}`, "2026-08-26T08:00:00.000Z", "2026-08-26T09:29:00.000Z",
    );
    if (options.includeMetering !== false) {
      database.prepare(`INSERT INTO hosting_v2_metering_proofs(
        id,contract_id,command_id,container_digest,runtime_state_digest,agent_started_at,agent_stopped_at,
        agent_runtime_seconds,server_measured_seconds,evidence_digest,recorded_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        `proof-managed-bridge-${suffix}`, contractId, `command-managed-bridge-${suffix}`,
        `sha256:${"1".repeat(64)}`, `sha256:${"2".repeat(64)}`,
        "2026-08-26T08:00:00.000Z", "2026-08-26T09:00:00.000Z", 3_600, 3_600,
        `sha256:${"3".repeat(64)}`, "2026-08-26T09:00:01.000Z",
      );
    }
  } finally {
    database.close();
  }
  return {
    ...fixture,
    active,
    buyer,
    cardHours,
    contractId,
    settlementInput: {
      buyerOrganizationId: buyer.activeOrganization.id,
      orderId: contractId,
      measuredSeconds: 3_600,
      settledMicros: 20_000_000,
      supplierOrganizationId,
      supplierIncomeMicros: 19_800_000,
      commissionMicros: 0,
      acceptanceMode: "BUYER",
      acceptanceDeadlineAt: "2026-08-26T09:30:00.000Z",
      acceptanceActorId: buyer.account.id,
      acceptancePayloadHash: "a".repeat(64),
      payloadHash: "b".repeat(64),
      now: "2026-08-26T09:30:00.000Z",
    },
  };
}

test("settlement refuses booking when no accepted, posted compute sale exists", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-no-sale-"));
  const path = join(directory, "managed-gpu.sqlite");
  try {
    const { store, admin, asset } = await createOwnedFixture(path);
    await assert.rejects(
      store.createSettlement(
        await approvedContext(store, admin, "CREATE_SETTLEMENT", asset.record.id, "settlement-no-sale"),
        { assetId: asset.record.id, periodStart: "2026-08-26T00:00:00.000Z", periodEnd: "2026-08-27T00:00:00.000Z", policyVersionId: "MGPU-POLICY-RISK", sourceKey: "no-real-sale" },
      ),
      (error) => error?.code === "MANAGED_GPU_SALES_EVIDENCE_MISSING",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("real compute-sale settlement is derived, idempotent and organization-isolated", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-settlement-"));
  const path = join(directory, "managed-gpu.sqlite");
  try {
    const { store, owner, admin, asset } = await createOwnedFixture(path);
    recordRealComputeSale(path, asset.record.id);
    const context = await approvedContext(store, admin, "CREATE_SETTLEMENT", asset.record.id, "settlement-replay");
    const input = { assetId: asset.record.id, periodStart: "2026-08-26T00:00:00.000Z", periodEnd: "2026-08-27T00:00:00.000Z", policyVersionId: "MGPU-POLICY-RISK", sourceKey: "actual-posted-card-hours" };
    const first = await store.createSettlement(context, input);
    const replay = await store.createSettlement(context, input);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.record.id, first.record.id);
    assert.deepEqual({
      gross: first.record.grossCardHourMicros,
      refund: first.record.refundCardHourMicros,
      platform: first.record.platformFeeMicros,
      wear: first.record.wearMicros,
      facility: first.record.facilityChargeMicros,
      net: first.record.netCardHourMicros,
      withdrawable: first.record.withdrawable,
      transferable: first.record.transferable,
    }, {
      gross: 100_000_000, refund: 0, platform: 1_000_000, wear: 7_000_000,
      facility: 8_000_000, net: 84_000_000, withdrawable: false, transferable: false,
    });
    assert.equal((await store.listMemberSettlements(owner.organizationId)).length, 1);
    assert.equal((await store.listMemberSettlements("org-attacker")).length, 0);
    await assert.rejects(
      store.createSettlement(
        { ...context, payloadHash: "f".repeat(64) },
        input,
      ),
      (error) => error?.code === "MANAGED_GPU_IDEMPOTENCY_CONFLICT",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("managed GPU invitation gate fails closed unless both the feature and exact organization are enabled", () => {
  assert.equal(managedGpuFeatureEnabled({}), false);
  assert.equal(managedGpuOrganizationInvited("org-invited", {}), false);
  assert.equal(managedGpuOrganizationEnabled("org-invited", { KAI_MANAGED_GPU_MVP: "1" }), false);
  assert.equal(managedGpuOrganizationEnabled("org-invited", {
    KAI_MANAGED_GPU_MVP: "1",
    KAI_MANAGED_GPU_INVITED_ORGANIZATIONS: "org-other, org-invited",
  }), true);
  assert.equal(managedGpuOrganizationEnabled("org-invite", {
    KAI_MANAGED_GPU_MVP: "1",
    KAI_MANAGED_GPU_INVITED_ORGANIZATIONS: "org-invited",
  }), false, "invitation matching must be exact rather than prefix based");
});

test("monthly settlement advances in order with separated reviewers and posts card hours exactly once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-settlement-post-"));
  const path = join(directory, "managed-gpu.sqlite");
  try {
    const { store, owner, admin, settlement: created } = await createSettlementFixture(path);
    assert.equal(created.status, "REVIEW_REQUIRED");

    const skip = await approvedContext(store, admin, "TRANSITION_SETTLEMENT", created.id, "skip-post");
    await assert.rejects(
      store.transitionSettlement(skip, created.id, { expectedStatus: "REVIEW_REQUIRED", toStatus: "POSTED" }),
      (error) => error?.code === "MANAGED_GPU_VALIDATION_ERROR",
    );

    const readyRequester = { organizationId: admin.organizationId, accountId: "acct-settlement-ready-requester" };
    const readyContext = await approvedContext(store, readyRequester, "TRANSITION_SETTLEMENT", created.id, "ready-step", {
      approverAccountId: "acct-settlement-ready-approver",
    });
    const ready = await store.transitionSettlement(readyContext, created.id, { expectedStatus: "REVIEW_REQUIRED", toStatus: "READY" });
    assert.equal(ready.record.status, "READY");

    const approveRequester = { organizationId: admin.organizationId, accountId: "acct-settlement-approve-requester" };
    const approveContext = await approvedContext(store, approveRequester, "TRANSITION_SETTLEMENT", created.id, "approve-step", {
      approverAccountId: "acct-settlement-approve-approver",
    });
    const approved = await store.transitionSettlement(approveContext, created.id, { expectedStatus: "READY", toStatus: "APPROVED" });
    assert.equal(approved.record.status, "APPROVED");

    const postRequester = { organizationId: admin.organizationId, accountId: "acct-settlement-post-requester" };
    const postContext = await approvedContext(store, postRequester, "TRANSITION_SETTLEMENT", created.id, "post-step", {
      approverAccountId: "acct-settlement-post-approver",
    });
    const posted = await store.transitionSettlement(postContext, created.id, { expectedStatus: "APPROVED", toStatus: "POSTED" });
    const replay = await store.transitionSettlement(postContext, created.id, { expectedStatus: "APPROVED", toStatus: "POSTED" });
    assert.equal(posted.record.status, "POSTED");
    assert.equal(replay.replayed, true);
    assert.equal(replay.record.ledgerBatchId, posted.record.ledgerBatchId);

    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      assert.equal(database.prepare("SELECT status FROM managed_gpu_approvals WHERE id=?").get(skip.approvalId)?.status, "APPROVED");
      assert.deepEqual(
        database.prepare("SELECT status FROM managed_gpu_settlement_events WHERE settlement_id=? ORDER BY sequence").all(created.id).map((row) => row.status),
        ["REVIEW_REQUIRED", "READY", "APPROVED", "POSTED"],
      );
      const immutable = database.prepare(`SELECT status,ledger_entry_id,gross_card_hour_micros,net_card_hour_micros
        FROM managed_gpu_settlements WHERE id=?`).get(created.id);
      assert.deepEqual({ ...immutable }, {
        status: "REVIEW_REQUIRED", ledger_entry_id: null,
        gross_card_hour_micros: 100_000_000, net_card_hour_micros: 84_000_000,
      });
      assert.throws(() => database.prepare("UPDATE managed_gpu_settlement_events SET status='REVERSED' WHERE settlement_id=? AND sequence=4").run(created.id), /immutable/u);
      assert.throws(() => database.prepare("UPDATE managed_gpu_settlements SET net_card_hour_micros=1 WHERE id=?").run(created.id), /immutable/u);
      const batches = database.prepare("SELECT operation,amount_micros,metadata_json FROM card_hour_ledger_batches WHERE business_key=?").all(`managed-gpu-income:${created.id}`);
      assert.equal(batches.length, 1, "idempotent replay must not duplicate the income ledger batch");
      assert.equal(batches[0].operation, "MANAGED_GPU_INCOME");
      assert.equal(batches[0].amount_micros, 84_000_000);
      assert.deepEqual(JSON.parse(batches[0].metadata_json), {
        sourceSystem: "MANAGED_GPU_INCOME", settlementId: created.id, assetId: created.assetId,
        withdrawable: false, transferable: false,
      });
      assert.deepEqual(
        database.prepare("SELECT account_code,side,amount_micros FROM card_hour_ledger_entries WHERE batch_id=? ORDER BY account_code").all(posted.record.ledgerBatchId).map((row) => ({ ...row })),
        [
          { account_code: "PLATFORM_MANAGED_GPU_INCOME", side: "DEBIT", amount_micros: 84_000_000 },
          { account_code: "USER_AVAILABLE", side: "CREDIT", amount_micros: 84_000_000 },
        ],
      );
      assert.equal(database.prepare("SELECT available_micros FROM card_hour_wallets WHERE organization_id=?").get(owner.organizationId)?.available_micros, 84_000_000);
    } finally {
      database.close();
    }
    assert.equal((await store.listMemberSettlements("org-attacker")).length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a competing settlement event rolls back wallet credit, ledger posting, receipt and approval consumption", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-settlement-race-"));
  const path = join(directory, "managed-gpu.sqlite");
  let racingDatabase;
  try {
    const { store, admin, owner, settlement: created } = await createSettlementFixture(path, GROSS_CARD_HOUR_MICROS, "posting-race");
    const readyContext = await approvedContext(store, { organizationId: admin.organizationId, accountId: "acct-race-ready-requester" }, "TRANSITION_SETTLEMENT", created.id, "race-ready", { approverAccountId: "acct-race-ready-approver" });
    await store.transitionSettlement(readyContext, created.id, { expectedStatus: "REVIEW_REQUIRED", toStatus: "READY" });
    const approveContext = await approvedContext(store, { organizationId: admin.organizationId, accountId: "acct-race-approve-requester" }, "TRANSITION_SETTLEMENT", created.id, "race-approve", { approverAccountId: "acct-race-approve-approver" });
    await store.transitionSettlement(approveContext, created.id, { expectedStatus: "READY", toStatus: "APPROVED" });
    const postRequester = { organizationId: admin.organizationId, accountId: "acct-race-post-requester" };
    const postContext = await approvedContext(store, postRequester, "TRANSITION_SETTLEMENT", created.id, "race-post", { approverAccountId: "acct-race-post-approver" });

    const racing = await createRacingManagedGpuStore(path, "settlement-post");
    racingDatabase = racing.database;
    await assert.rejects(
      racing.store.transitionSettlement(postContext, created.id, { expectedStatus: "APPROVED", toStatus: "POSTED" }),
      /UNIQUE constraint failed/u,
    );
    assert.equal(racingDatabase.prepare("SELECT status FROM managed_gpu_approvals WHERE id=?").get(postContext.approvalId)?.status, "APPROVED");
    assert.equal(racingDatabase.prepare("SELECT COUNT(*) count FROM card_hour_wallets WHERE organization_id=?").get(owner.organizationId)?.count, 0);
    assert.equal(racingDatabase.prepare("SELECT COUNT(*) count FROM card_hour_ledger_batches WHERE business_key=?").get(`managed-gpu-income:${created.id}`)?.count, 0);
    assert.equal(racingDatabase.prepare("SELECT COUNT(*) count FROM managed_gpu_command_receipts WHERE command_scope='TRANSITION_SETTLEMENT' AND idempotency_key=?").get(postContext.idempotencyKey)?.count, 0);
    assert.equal(racingDatabase.prepare("SELECT status FROM managed_gpu_settlement_events WHERE id='mgse_competing'").get()?.status, "REVERSED");
  } finally {
    racingDatabase?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("settlement snapshots lifetime fee tier and hardware wear instead of trusting request amounts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-fee-tier-"));
  const path = join(directory, "managed-gpu.sqlite");
  try {
    const { settlement: created } = await createSettlementFixture(path, 10_000_000_000, "growth-tier");
    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      const snapshot = database.prepare(`SELECT fee_tier_code,platform_fee_bps,wear_reserve_bps,
        platform_fee_micros,wear_micros,facility_charge_micros,net_card_hour_micros
        FROM managed_gpu_settlements WHERE id=?`).get(created.id);
      assert.deepEqual({ ...snapshot }, {
        fee_tier_code: "GROWTH", platform_fee_bps: 80, wear_reserve_bps: 700,
        platform_fee_micros: 80_000_000, wear_micros: 700_000_000,
        facility_charge_micros: 8_000_000, net_card_hour_micros: 9_212_000_000,
      });
      assert.deepEqual(
        database.prepare("SELECT minimum_lifetime_card_hour_micros,platform_fee_bps FROM managed_gpu_fee_tiers ORDER BY minimum_lifetime_card_hour_micros").all().map((row) => ({ ...row })),
        [
          { minimum_lifetime_card_hour_micros: 0, platform_fee_bps: 100 },
          { minimum_lifetime_card_hour_micros: 10_000_000_000, platform_fee_bps: 80 },
          { minimum_lifetime_card_hour_micros: 50_000_000_000, platform_fee_bps: 60 },
          { minimum_lifetime_card_hour_micros: 200_000_000_000, platform_fee_bps: 40 },
          { minimum_lifetime_card_hour_micros: 1_000_000_000_000, platform_fee_bps: 20 },
        ],
      );
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("insufficient production records a seven-day asset debt without negative income or changing ownership", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-shortfall-"));
  const path = join(directory, "managed-gpu.sqlite");
  try {
    const { store, owner, admin, asset, settlement: created } = await createSettlementFixture(path, 5_000_000, "shortfall");
    assert.deepEqual({
      earned: created.earnedCardHourMicros,
      charges: created.totalChargeMicros,
      applied: created.appliedDeductionMicros,
      shortfall: created.shortfallMicros,
      net: created.netCardHourMicros,
    }, { earned: 5_000_000, charges: 8_400_000, applied: 5_000_000, shortfall: 3_400_000, net: 0 });
    assert.equal(created.earnedCardHourMicros, created.appliedDeductionMicros + created.netCardHourMicros);
    assert.equal(created.shortfallMicros, created.totalChargeMicros - created.appliedDeductionMicros);

    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      const fee = database.prepare("SELECT organization_id,asset_id,amount_micros,due_at,automatic_debit_authorization_id FROM managed_gpu_outstanding_hosting_fees WHERE settlement_id=?").get(created.id);
      assert.deepEqual({ ...fee }, {
        organization_id: owner.organizationId, asset_id: asset.record.id, amount_micros: 3_400_000,
        due_at: "2026-09-02T08:00:00.000Z", automatic_debit_authorization_id: null,
      });
      assert.equal(database.prepare("SELECT COUNT(*) count FROM card_hour_wallets WHERE organization_id=?").get(owner.organizationId)?.count, 0);
      assert.equal(database.prepare("SELECT owner_organization_id FROM managed_gpu_physical_assets WHERE id=?").get(asset.record.id)?.owner_organization_id, owner.organizationId);
      assert.throws(() => database.prepare("UPDATE managed_gpu_outstanding_hosting_fees SET amount_micros=1 WHERE settlement_id=?").run(created.id), /immutable/u);
    } finally {
      database.close();
    }

    const readyContext = await approvedContext(store, { organizationId: admin.organizationId, accountId: "acct-shortfall-ready-requester" }, "TRANSITION_SETTLEMENT", created.id, "shortfall-ready", { approverAccountId: "acct-shortfall-ready-approver" });
    await store.transitionSettlement(readyContext, created.id, { expectedStatus: "REVIEW_REQUIRED", toStatus: "READY" });
    const approveContext = await approvedContext(store, { organizationId: admin.organizationId, accountId: "acct-shortfall-approve-requester" }, "TRANSITION_SETTLEMENT", created.id, "shortfall-approve", { approverAccountId: "acct-shortfall-approve-approver" });
    await assert.rejects(
      store.transitionSettlement(approveContext, created.id, { expectedStatus: "READY", toStatus: "APPROVED" }),
      (error) => error?.code === "MANAGED_GPU_OUTSTANDING_FEE_PENDING",
    );

    const hostingSource = readFileSync(new URL("../lib/server/hosting-v2-store-core.ts", import.meta.url), "utf8");
    assert.match(hostingSource, /asset\.agent_binding_id=\?/u);
    assert.match(hostingSource, /fee\.due_at<=\?/u);
    assert.doesNotMatch(hostingSource, /managed_gpu_outstanding_hosting_fees[\s\S]{0,300}organization_id=\?/u,
      "overdue hosting debt must block only the linked asset, not every asset owned by the organization");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Beidou exit snapshots thirty days and shipping cannot bypass drain, settlement or dedicated approval", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-shipping-"));
  const path = join(directory, "managed-gpu.sqlite");
  try {
    const { store, owner, admin, asset } = await createOwnedFixture(path);
    const active = await activateAsset(store, admin, asset.record);
    const exit = await store.createServiceRequest(
      mutation(owner.organizationId, owner.accountId, "exit-30d", "exit-30d-hash"),
      { assetId: active.id, requestType: "EXIT_HOSTING", destinationCountryCode: null, addressReference: null, reason: "Owner requests physical delivery." },
    );
    assert.equal(exit.record.earliestExecutionAt, "2026-09-25T08:00:00.000Z");
    const shipping = await store.createServiceRequest(
      mutation(owner.organizationId, owner.accountId, "ship-30d", "ship-30d-hash"),
      { assetId: active.id, requestType: "GLOBAL_SHIPPING", destinationCountryCode: "US", addressReference: "address-token-risk", reason: "Ship after hosting exit." },
    );
    const drainNow = "2026-09-25T07:55:00.000Z";
    const draining = await store.transitionAsset(
      await approvedContext(store, admin, "TRANSITION_ASSET", active.id, "drain-step", { now: drainNow }),
      active.id,
      { expectedVersion: active.version, toStatus: "DRAINING", evidenceDigest: "d".repeat(64), agentBindingId: "agent-risk", verifiedAt: drainNow, allocationCount: 0, processCount: 0 },
    );
    const bypass = await approvedContext(store, admin, "TRANSITION_ASSET", active.id, "ship-bypass", { now: drainNow });
    await assert.rejects(
      store.transitionAsset(bypass, active.id, { expectedVersion: draining.record.version, toStatus: "SHIPPING", evidenceDigest: "e".repeat(64), agentBindingId: "agent-risk" }),
      (error) => error?.code === "MANAGED_GPU_SHIP_ASSET_PATH_REQUIRED",
    );

    const shipContext = await approvedContext(store, admin, "SHIP_ASSET", shipping.record.id, "ship-dedicated", { now: "2026-09-25T07:59:59.999Z" });
    await assert.rejects(
      store.shipAsset(shipContext, shipping.record.id, { expectedVersion: shipping.record.version, evidenceDigest: "f".repeat(64) }),
      (error) => error?.code === "MANAGED_GPU_EXIT_NOTICE_PENDING",
    );
    const completed = await store.shipAsset(
      { ...shipContext, now: "2026-09-25T08:00:00.000Z" },
      shipping.record.id,
      { expectedVersion: shipping.record.version, evidenceDigest: "f".repeat(64) },
    );
    assert.equal(completed.record.status, "SHIPPING");
    assert.equal(completed.record.ownerOrganizationId, owner.organizationId);
    assert.equal(completed.serviceRequest.status, "COMPLETED");
    const replay = await store.shipAsset(
      { ...shipContext, now: "2026-09-25T08:00:00.000Z" },
      shipping.record.id,
      { expectedVersion: shipping.record.version, evidenceDigest: "f".repeat(64) },
    );
    assert.equal(replay.replayed, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an order created for global shipping can ship after verification without a hosting-exit notice", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-initial-shipping-"));
  const path = join(directory, "managed-gpu.sqlite");
  try {
    const { store, owner, admin, asset } = await createOwnedFixture(path, { fulfillmentChoice: "GLOBAL_SHIPPING" });
    let current = asset.record;
    for (const [index, toStatus] of [[1, "RECEIVED"], [2, "INSPECTING"], [3, "VERIFIED"]]) {
      current = (await store.transitionAsset(
        await approvedContext(store, admin, "TRANSITION_ASSET", asset.record.id, `initial-ship-${index}`),
        asset.record.id,
        { expectedVersion: current.version, toStatus, evidenceDigest: String(index).repeat(64), agentBindingId: null },
      )).record;
    }
    const request = await store.createServiceRequest(
      mutation(owner.organizationId, owner.accountId, "initial-global-shipping", "initial-global-shipping-hash"),
      { assetId: current.id, requestType: "GLOBAL_SHIPPING", destinationCountryCode: "US", addressReference: "initial-address-token", reason: "Original global shipping order." },
    );
    const result = await store.shipAsset(
      await approvedContext(store, admin, "SHIP_ASSET", request.record.id, "initial-ship-execute"),
      request.record.id,
      { expectedVersion: request.record.version, evidenceDigest: "8".repeat(64) },
    );
    assert.equal(result.record.status, "SHIPPING");
    assert.equal(result.record.ownerOrganizationId, owner.organizationId);
    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      assert.equal(database.prepare("SELECT COUNT(*) count FROM managed_gpu_service_requests WHERE asset_id=? AND request_type='EXIT_HOSTING'").get(current.id)?.count, 0);
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepted Hosting V2 usage bridges one real capture and refund into one net managed-GPU monthly settlement", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-hosting-bridge-"));
  const path = join(directory, "managed-gpu.sqlite");
  let fixture;
  let secondCardHours;
  try {
    fixture = await createManagedHostingBridgeFixture(path, "happy");
    secondCardHours = await createSqliteCardHourStore(path);
    const raced = await Promise.allSettled([
      fixture.cardHours.settleHostingOrder(fixture.settlementInput),
      secondCardHours.settleHostingOrder(fixture.settlementInput),
    ]);
    assert.equal(raced.filter((result) => result.status === "fulfilled" && result.value.applied).length, 1);

    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      const captures = database.prepare(`SELECT sale.asset_id,sale.hosting_contract_id,sale.acceptance_event_id,
        sale.capture_batch_id,sale.event_type,sale.accepted_gpu_seconds,sale.card_hour_micros,sale.payload_digest,
        batch.operation,json_extract(batch.metadata_json,'$.sourceSystem') source_system
        FROM managed_gpu_compute_sale_events sale JOIN card_hour_ledger_batches batch ON batch.id=sale.capture_batch_id
        WHERE sale.hosting_contract_id=?`).all(fixture.contractId);
      assert.equal(captures.length, 1, "acceptance retries and races must produce exactly one captured sale fact");
      assert.deepEqual({ ...captures[0] }, {
        asset_id: fixture.active.id,
        hosting_contract_id: fixture.contractId,
        acceptance_event_id: fixture.contractId,
        capture_batch_id: captures[0].capture_batch_id,
        event_type: "CAPTURED",
        accepted_gpu_seconds: 3_600,
        card_hour_micros: 20_000_000,
        payload_digest: "a".repeat(64),
        operation: "ORDER_CAPTURE",
        source_system: "HOSTING_V2",
      });
      assert.equal(database.prepare("SELECT COUNT(*) count FROM card_hour_ledger_batches WHERE operation='RENTAL_INCOME' AND business_key LIKE ?").get(`%${fixture.contractId}`)?.count, 0,
        "managed assets must not receive immediate Hosting rental income before monthly settlement");
      assert.equal(database.prepare("SELECT COUNT(*) count FROM card_hour_income_accruals WHERE source_system='HOSTING_V2' AND source_id=? AND income_type='RENTAL'").get(fixture.contractId)?.count, 0);

      assert.throws(() => database.prepare(`INSERT INTO card_hour_ledger_batches(
        id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at)
        VALUES('refund-no-proof',?,'ORDER_REFUND',?,5000000,'POSTED',?,'2026-08-26T10:00:00.000Z')`).run(
        fixture.buyer.activeOrganization.id,
        `refund-no-proof:${fixture.contractId}`,
        JSON.stringify({ sourceSystem: "HOSTING_V2", orderId: fixture.contractId }),
      ), /managed gpu refund evidence required/u);
      database.prepare(`INSERT INTO card_hour_ledger_batches(
        id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at)
        VALUES('refund-with-proof',?,'ORDER_REFUND',?,5000000,'POSTED',?,'2026-08-26T10:00:00.000Z')`).run(
        fixture.buyer.activeOrganization.id,
        `refund-with-proof:${fixture.contractId}`,
        JSON.stringify({ sourceSystem: "HOSTING_V2", orderId: fixture.contractId, refundPayloadDigest: "c".repeat(64) }),
      );
      assert.throws(() => database.prepare(`INSERT INTO card_hour_ledger_batches(
        id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at)
        VALUES('refund-duplicate',?,'ORDER_REFUND',?,1000000,'POSTED',?,'2026-08-26T10:01:00.000Z')`).run(
        fixture.buyer.activeOrganization.id,
        `refund-duplicate:${fixture.contractId}`,
        JSON.stringify({ sourceSystem: "HOSTING_V2", orderId: fixture.contractId, refundPayloadDigest: "d".repeat(64) }),
      ), /managed gpu sale already reversed/u);
      assert.equal(database.prepare("SELECT COUNT(*) count FROM card_hour_ledger_batches WHERE id='refund-duplicate'").get()?.count, 0,
        "a duplicate reversal and its ledger batch must roll back atomically");
      assert.deepEqual(
        database.prepare("SELECT event_type,card_hour_micros,payload_digest FROM managed_gpu_compute_sale_events WHERE hosting_contract_id=? ORDER BY event_type").all(fixture.contractId).map((row) => ({ ...row })),
        [
          { event_type: "CAPTURED", card_hour_micros: 20_000_000, payload_digest: "a".repeat(64) },
          { event_type: "REFUNDED", card_hour_micros: 5_000_000, payload_digest: "c".repeat(64) },
        ],
      );
    } finally {
      database.close();
    }

    const created = await fixture.store.createSettlement(
      await approvedContext(fixture.store, fixture.admin, "CREATE_SETTLEMENT", fixture.active.id, "bridge-monthly"),
      {
        assetId: fixture.active.id,
        periodStart: "2026-08-26T00:00:00.000Z",
        periodEnd: "2026-08-27T00:00:00.000Z",
        policyVersionId: "MGPU-POLICY-RISK",
        sourceKey: "hosting-bridge-net-settlement",
      },
    );
    assert.deepEqual({
      gross: created.record.grossCardHourMicros,
      refund: created.record.refundCardHourMicros,
      earned: created.record.earnedCardHourMicros,
      platform: created.record.platformFeeMicros,
      wear: created.record.wearMicros,
      facility: created.record.facilityChargeMicros,
      net: created.record.netCardHourMicros,
    }, {
      gross: 20_000_000, refund: 5_000_000, earned: 15_000_000,
      platform: 150_000, wear: 1_050_000, facility: 8_000_000, net: 5_800_000,
    });
  } finally {
    secondCardHours?.close();
    fixture?.cardHours.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("managed-GPU bridge fails closed without metering, deduction, active ownership or matching supplier", async () => {
  for (const [label, options, expectedCode] of [
    ["missing-metering", { includeMetering: false }, null],
    ["cross-owner", { supplierOrganizationId: "org-cross-owner-attacker" }, "MANAGED_GPU_ASSET_ORGANIZATION_MISMATCH"],
  ]) {
    const directory = mkdtempSync(join(tmpdir(), `kai-managed-gpu-risk-bridge-${label}-`));
    const path = join(directory, "managed-gpu.sqlite");
    let fixture;
    try {
      fixture = await createManagedHostingBridgeFixture(path, label, options);
      await assert.rejects(
        fixture.cardHours.settleHostingOrder(fixture.settlementInput),
        expectedCode ? (error) => error?.code === expectedCode : undefined,
      );
      const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
      try {
        assert.equal(database.prepare("SELECT COUNT(*) count FROM managed_gpu_compute_sale_events WHERE hosting_contract_id=?").get(fixture.contractId)?.count, 0);
        assert.equal(database.prepare("SELECT COUNT(*) count FROM hosting_v2_acceptance_proofs WHERE contract_id=?").get(fixture.contractId)?.count, 0);
        assert.equal(database.prepare("SELECT COUNT(*) count FROM card_hour_ledger_batches WHERE business_key=?").get(`order:HOSTING_V2:${fixture.contractId}`)?.count, 0);
        if (label === "missing-metering") {
          database.prepare(`INSERT INTO hosting_v2_acceptance_proofs(
            contract_id,decision_mode,acceptance_window_seconds,deadline_at,decided_at,actor_id,payload_digest)
            VALUES(?,'BUYER',1800,'2026-08-26T09:30:00.000Z','2026-08-26T09:30:00.000Z',?,?)`).run(
            fixture.contractId, fixture.buyer.account.id, "f".repeat(64),
          );
        }
      } finally {
        database.close();
      }
      await assert.rejects(
        fixture.store.createSettlement(
          await approvedContext(fixture.store, fixture.admin, "CREATE_SETTLEMENT", fixture.active.id, `bridge-no-evidence-${label}`),
          { assetId: fixture.active.id, periodStart: "2026-08-26T00:00:00.000Z", periodEnd: "2026-08-27T00:00:00.000Z", policyVersionId: "MGPU-POLICY-RISK", sourceKey: `bridge-no-evidence-${label}` },
        ),
        (error) => error?.code === "MANAGED_GPU_SALES_EVIDENCE_MISSING",
      );
    } finally {
      fixture?.cardHours.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }

  const directory = mkdtempSync(join(tmpdir(), "kai-managed-gpu-risk-bridge-inactive-"));
  const path = join(directory, "managed-gpu.sqlite");
  let fixture;
  try {
    fixture = await createManagedHostingBridgeFixture(path, "inactive");
    await fixture.store.transitionAsset(
      await approvedContext(fixture.store, fixture.admin, "TRANSITION_ASSET", fixture.active.id, "bridge-maintenance"),
      fixture.active.id,
      { expectedVersion: fixture.active.version, toStatus: "MAINTENANCE", evidenceDigest: "9".repeat(64), agentBindingId: fixture.active.agentBindingId },
    );
    await assert.rejects(
      fixture.cardHours.settleHostingOrder(fixture.settlementInput),
      (error) => error?.code === "MANAGED_GPU_ASSET_NOT_ACTIVE",
    );
    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      assert.equal(database.prepare("SELECT COUNT(*) count FROM managed_gpu_compute_sale_events WHERE hosting_contract_id=?").get(fixture.contractId)?.count, 0);
      assert.equal(database.prepare("SELECT COUNT(*) count FROM card_hour_ledger_batches WHERE business_key=?").get(`order:HOSTING_V2:${fixture.contractId}`)?.count, 0);
    } finally {
      database.close();
    }
  } finally {
    fixture?.cardHours.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("active facilities require approved custody terms and physical assets have one unique Agent binding", () => {
  const database = createDatabase();
  try {
    assert.throws(() => database.prepare(`INSERT INTO managed_gpu_facilities(
      id,code,display_name,country_code,region,timezone,status,custody_terms_version,created_at,updated_at,version)
      VALUES('MGPU-FAC-PENDING-ACTIVE','PENDING_ACTIVE','Unsafe active facility','CN','上海','Asia/Shanghai','ACTIVE','PENDING',?,?,1)`).run(
      "2026-08-26T00:00:00.000Z", "2026-08-26T00:00:00.000Z",
    ), /CHECK constraint failed/u);
    seedDirectAsset(database);
    assert.throws(() => database.prepare(`INSERT INTO managed_gpu_physical_assets(
      id,order_id,unit_index,owner_organization_id,product_version_id,facility_id,serial_fingerprint,
      acquisition_amount_minor,currency,ownership_bps,agent_binding_id,status,version,created_at,updated_at)
      SELECT 'mga_agent_duplicate',order_id,2,owner_organization_id,product_version_id,facility_id,
        'sha256:agent-duplicate',acquisition_amount_minor,currency,10000,agent_binding_id,'ACTIVE',1,created_at,updated_at
      FROM managed_gpu_physical_assets WHERE id='mga_risk'`).run(), /UNIQUE constraint failed/u);
  } finally {
    database.close();
  }
});

test("0022 production baseline migrates additively through managed GPU 0040 and card-hour posting 0041", () => {
  const sqlite0040 = readFileSync(new URL("../drizzle/0040_managed_gpu_mvp.sql", import.meta.url), "utf8");
  const d10040 = readFileSync(new URL("../.openai/drizzle/0040_managed_gpu_mvp.sql", import.meta.url), "utf8");
  const sqlite0041 = readFileSync(new URL("../drizzle/0041_card_hour_managed_gpu_income.sql", import.meta.url), "utf8");
  const d10041 = readFileSync(new URL("../.openai/drizzle/0041_card_hour_managed_gpu_income.sql", import.meta.url), "utf8");
  assert.equal(sqlite0040, d10040);
  assert.equal(sqlite0041, d10041);

  const database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  try {
    database.exec("CREATE TABLE admin_identity_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)");
    database.exec(readFileSync(new URL("../drizzle/0022_admin_password_card_hours.sql", import.meta.url), "utf8"));
    database.prepare(`INSERT INTO card_hour_ledger_batches(id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at)
      VALUES('legacy-batch','org-legacy','TOPUP','legacy-business',5000000,'POSTED','{}','2026-08-22T00:00:00.000Z')`).run();
    database.prepare(`INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at)
      VALUES('legacy-entry','legacy-batch','org-legacy','USER_AVAILABLE','CREDIT',5000000,5000000,'2026-08-22T00:00:00.000Z')`).run();
    database.exec(sqlite0040);
    database.exec(sqlite0041);
    assert.equal(database.prepare("SELECT MAX(version) version FROM managed_gpu_schema_migrations").get()?.version, 2);
    assert.equal(database.prepare("SELECT MAX(version) version FROM card_hour_schema_migrations").get()?.version, 8);
    assert.deepEqual({ ...database.prepare("SELECT operation,amount_micros FROM card_hour_ledger_batches WHERE id='legacy-batch'").get() }, { operation: "TOPUP", amount_micros: 5_000_000 });
    database.prepare(`INSERT INTO card_hour_ledger_batches(id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at)
      VALUES('managed-income','org-owner','MANAGED_GPU_INCOME','managed-income-business',1,'POSTED','{}','2026-08-26T00:00:00.000Z')`).run();
    assert.equal(database.prepare("SELECT COUNT(*) count FROM managed_gpu_product_versions").get()?.count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='index' AND name='managed_gpu_assets_agent_binding_unique'").get()?.count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='trigger' AND name='managed_gpu_sale_refund_duplicate_guard'").get()?.count, 1);
    assert.throws(() => database.prepare(`INSERT INTO managed_gpu_facilities(
      id,code,display_name,country_code,region,timezone,status,custody_terms_version,created_at,updated_at,version)
      VALUES('migration-active-pending','MIGRATION_PENDING','Unsafe migration facility','CN','上海','Asia/Shanghai','ACTIVE','PENDING',?,?,1)`).run(
      "2026-08-26T00:00:00.000Z", "2026-08-26T00:00:00.000Z",
    ), /CHECK constraint failed/u);
  } finally {
    database.close();
  }
});
