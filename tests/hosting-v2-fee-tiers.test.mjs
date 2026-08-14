import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  HOSTING_FEE_QUALIFICATION_MODEL,
  hostingActualFeeBreakdown,
  hostingCurrentCalendarMonth,
  hostingDefaultFeeTiers,
  hostingPreviousCalendarMonth,
  hostingSelectFeeTier,
} from "../lib/hosting-v2.ts";
import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";

test("default Hosting fee tiers decrease from 100 to 20 bps and keep referral inside the platform fee", () => {
  const tiers = hostingDefaultFeeTiers(1_000, 300);
  assert.deepEqual(tiers, [
    { code: "STARTER", minimumQualifyingMicros: 0, platformFeeBps: 100, referralRewardBps: 30 },
    { code: "GROWTH", minimumQualifyingMicros: 1_000_000_000, platformFeeBps: 80, referralRewardBps: 24 },
    { code: "SCALE", minimumQualifyingMicros: 10_000_000_000, platformFeeBps: 60, referralRewardBps: 18 },
    { code: "VOLUME", minimumQualifyingMicros: 50_000_000_000, platformFeeBps: 40, referralRewardBps: 12 },
    { code: "STRATEGIC", minimumQualifyingMicros: 100_000_000_000, platformFeeBps: 20, referralRewardBps: 6 },
  ]);
  for (const tier of tiers) assert.ok(tier.referralRewardBps <= tier.platformFeeBps);
  assert.equal(hostingSelectFeeTier(tiers, 0).code, "STARTER");
  assert.equal(hostingSelectFeeTier(tiers, 999_999_999).code, "STARTER");
  assert.equal(hostingSelectFeeTier(tiers, 1_000_000_000).code, "GROWTH");
  assert.equal(hostingSelectFeeTier(tiers, 99_999_999_999).code, "VOLUME");
  assert.equal(hostingSelectFeeTier(tiers, 100_000_000_000).code, "STRATEGIC");
  assert.equal(hostingSelectFeeTier(tiers, Number.MAX_SAFE_INTEGER).code, "STRATEGIC");
});

test("fee qualification uses the previous complete Asia/Shanghai calendar month", () => {
  assert.deepEqual(hostingPreviousCalendarMonth("2026-08-14T09:00:00.000Z"), {
    key: "2026-07",
    startAt: "2026-06-30T16:00:00.000Z",
    endAt: "2026-07-31T16:00:00.000Z",
    timeZone: "Asia/Shanghai",
  });
  assert.deepEqual(hostingPreviousCalendarMonth("2026-01-01T00:00:00.000Z"), {
    key: "2025-12",
    startAt: "2025-11-30T16:00:00.000Z",
    endAt: "2025-12-31T16:00:00.000Z",
    timeZone: "Asia/Shanghai",
  });
  assert.equal(HOSTING_FEE_QUALIFICATION_MODEL, "PREVIOUS_CALENDAR_MONTH_SUPPLIER_SETTLED_GROSS_V1");
});

test("current settlement month uses Asia/Shanghai boundaries and actual amounts close exactly", () => {
  assert.deepEqual(hostingCurrentCalendarMonth("2026-08-14T09:00:00.000Z"), {
    key: "2026-08",
    startAt: "2026-07-31T16:00:00.000Z",
    endAt: "2026-08-31T16:00:00.000Z",
    timeZone: "Asia/Shanghai",
  });
  assert.deepEqual(hostingActualFeeBreakdown(180_000, 178_200, 540), {
    grossMicros: 180_000,
    platformFeeMicros: 1_800,
    supplierIncomeMicros: 178_200,
    inFeeReferralCommissionMicros: 540,
    platformNetMicros: 1_260,
  });
  assert.throws(() => hostingActualFeeBreakdown(100, 99, 2), /HOSTING_ACTUAL_FEE_AMOUNTS_INVALID/u);
});

test("invalid or non-decreasing fee tiers fail closed", () => {
  assert.throws(() => hostingSelectFeeTier([], 0), /HOSTING_FEE_TIERS_INVALID/u);
  assert.throws(() => hostingSelectFeeTier([
    { code: "STARTER", minimumQualifyingMicros: 0, platformFeeBps: 100, referralRewardBps: 10 },
    { code: "BROKEN", minimumQualifyingMicros: 1_000_000, platformFeeBps: 100, referralRewardBps: 10 },
  ], 1_000_000), /HOSTING_FEE_TIERS_INVALID/u);
  assert.throws(() => hostingSelectFeeTier(hostingDefaultFeeTiers(100, 20), -1), /HOSTING_FEE_QUALIFYING_VOLUME_INVALID/u);
});

test("supplier monthly settlement includes only current non-refunded supplier orders and fails closed on corrupt splits", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-fee-read-model-"));
  const path = join(directory, "fee-read-model.sqlite");
  const store = await createSqliteHostingV2Store(path);
  const db = new DatabaseSync(path);
  const insertContract = db.prepare(`INSERT INTO hosting_v2_contracts(
    id,offer_id,device_id,buyer_organization_id,buyer_account_id,supplier_organization_id,fee_schedule_id,snapshot_json,
    reserved_seconds,held_micros,settled_micros,supplier_income_micros,commission_micros,status,accepted_at,idempotency_key,payload_hash,version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const addContract = (id, supplier, acceptedAt, gross, income, commission, status = "CLEANED") => insertContract.run(
    id, `offer_${id}`, `device_${id}`, `buyer_${id}`, `account_${id}`, supplier, "fee_test", "{}",
    180, gross, gross, income, commission, status, acceptedAt, `key_${id}`, `hash_${id}`, 1, acceptedAt, acceptedAt,
  );
  try {
    addContract("current_a", "supplier_a", "2026-08-10T00:00:00.000Z", 1_000_000, 990_000, 3_000);
    addContract("current_b", "supplier_a", "2026-08-11T00:00:00.000Z", 500_000, 495_000, 0, "CLEANING");
    addContract("refunded", "supplier_a", "2026-08-12T00:00:00.000Z", 9_000_000, 8_910_000, 27_000);
    addContract("other_supplier", "supplier_b", "2026-08-12T00:00:00.000Z", 8_000_000, 7_920_000, 24_000);
    addContract("previous_month", "supplier_a", "2026-07-10T00:00:00.000Z", 7_000_000, 6_930_000, 21_000);
    db.prepare(`INSERT INTO hosting_v2_dispute_resolution_proposals(
      id,contract_id,proposal_version,resolution,request_reason,requested_by,status,requested_at)
      VALUES('proposal_refunded','refunded',1,'REFUND','refund test','admin','APPLIED','2026-08-12T00:00:00.000Z')`).run();
    assert.deepEqual(await store.supplierMonthlySettlement("supplier_a", "2026-08-14T09:00:00.000Z"), {
      period: hostingCurrentCalendarMonth("2026-08-14T09:00:00.000Z"),
      grossMicros: 1_500_000,
      platformFeeMicros: 15_000,
      supplierIncomeMicros: 1_485_000,
      inFeeReferralCommissionMicros: 3_000,
      platformNetMicros: 12_000,
    });

    addContract("invalid_split", "supplier_a", "2026-08-13T00:00:00.000Z", 100, 99, 2);
    await assert.rejects(() => store.supplierMonthlySettlement("supplier_a", "2026-08-14T09:00:00.000Z"), (error) => error?.code === "HOSTING_SETTLEMENT_FEE_AMOUNTS_INVALID");
  } finally {
    db.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fee tier migration is additive, immutable and identical for both runtimes", () => {
  const local = readFileSync(new URL("../drizzle/0026_hosting_fee_tiers.sql", import.meta.url), "utf8");
  const hosted = readFileSync(new URL("../.openai/drizzle/0026_hosting_fee_tiers.sql", import.meta.url), "utf8");
  assert.equal(local, hosted);
  assert.match(local, /CREATE TABLE IF NOT EXISTS hosting_v2_fee_tiers/u);
  assert.match(local, /platform_fee_bps INTEGER NOT NULL CHECK \(platform_fee_bps BETWEEN 20 AND 100\)/u);
  assert.match(local, /immutable_update/u);
  assert.match(local, /immutable_delete/u);
  assert.match(local, /VALUES\(12,datetime\('now'\)\)/u);
  assert.doesNotMatch(local, /\bDROP\b|\bDELETE\s+FROM\b|\bALTER\s+TABLE\s+\w+\s+DROP\b/iu);
});
