import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createSqliteStandardizationStore } from "../lib/server/standardization-store-sqlite.ts";
import { createD1StandardizationStore } from "../lib/server/standardization-store-d1.ts";

const NOW = new Date("2026-08-08T06:00:00.000Z");

function context(hash = "payload-hash-v1", idempotencyKey = "snapshot-20260808-0001") {
  return {
    actorId: "market-index-job",
    idempotencyKey,
    payloadHash: hash,
    reason: "发布每日 KAI 标准卡时行情快照",
  };
}

function sample(sampleId, productCode, price, options = {}) {
  const productVersions = {
    GPU_COMPUTE: "PV-GPU-H100-SXM5-80GB",
    MODEL_INSTANCE: "PV-MODEL-DEEPSEEK-V4-PRO-STANDARD-V1",
    TOKEN_THROUGHPUT: "PV-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1",
    NAS_STORAGE: "PV-NAS-NFS41-BALANCED-1TIB-V1",
    RACK_SPACE: "PV-RACK-42U-10KW-MANAGED-V1",
  };
  return {
    sampleId,
    productCode,
    productVersionId: options.productVersionId ?? productVersions[productCode],
    region: options.region ?? "华北",
    unitPriceCnyMicros: String(price),
    benchmark: options.benchmark ?? false,
    promotional: options.promotional ?? false,
    marketIndexEligible: options.marketIndexEligible ?? true,
    sourceSystem: options.sourceSystem ?? "EXCHANGE",
    observedAt: options.observedAt ?? "2026-08-08T05:00:00.000Z",
  };
}

function snapshotInput() {
  const samples = [];
  [18, 19, 20, 21, 22].forEach((price, index) => samples.push(sample(
    `benchmark-${index}`,
    "GPU_COMPUTE",
    price * 1_000_000,
    { benchmark: true, region: "全国" },
  )));
  [28, 29, 30, 31, 32].forEach((price, index) => samples.push(sample(
    `gpu-market-${index}`,
    "GPU_COMPUTE",
    price * 1_000_000,
  )));
  samples.push(sample("gpu-promo-low", "GPU_COMPUTE", 1_000_000, { promotional: true }));
  samples.push(sample("gpu-pilot-low", "GPU_COMPUTE", 500_000, { sourceSystem: "SUPPLY_PILOT" }));
  samples.push(sample("gpu-ineligible", "GPU_COMPUTE", 700_000, { marketIndexEligible: false }));
  samples.push(sample("gpu-stale-old", "GPU_COMPUTE", 900_000, { observedAt: "2026-07-31T04:59:59.000Z" }));
  [8, 9, 10, 11, 12].forEach((price, index) => samples.push(sample(
    `gpu-4090-${index}`,
    "GPU_COMPUTE",
    price * 1_000_000,
    { productVersionId: "PV-GPU-RTX4090-PCIE-24GB" },
  )));
  [2, 3, 4, 5, 6].forEach((price, index) => samples.push(sample(
    `nas-market-${index}`,
    "NAS_STORAGE",
    price * 1_000_000,
  )));
  return { asOf: "2026-08-08T05:00:00.000Z", expiresAt: "2026-08-09T05:00:00.000Z", samples };
}

function d1BackedBySqlite() {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  const prepare = (sql) => {
    let values = [];
    const wrapper = {
      bind(...nextValues) { values = nextValues; return wrapper; },
      async run() {
        const result = db.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      async all() { return { success: true, results: db.prepare(sql).all(...values) }; },
      async first() { return db.prepare(sql).get(...values) ?? null; },
      rawRun() {
        const result = db.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
    return wrapper;
  };
  return {
    db,
    adapter: {
      prepare,
      async batch(statements) {
        db.exec("BEGIN IMMEDIATE");
        try {
          const results = statements.map((statement) => statement.rawRun());
          db.exec("COMMIT");
          return results;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    },
  };
}

async function assertSnapshotBehavior(store, db) {
  const unavailable = await store.getQuotes(NOW);
  assert.equal(unavailable.snapshot.status, "UNAVAILABLE");
  assert.deepEqual(unavailable.quotes, []);
  assert.equal(unavailable.snapshot.p50CnyMicros, null);

  const concurrent = await Promise.all([
    store.appendSnapshot(context(), snapshotInput()),
    store.appendSnapshot(context(), snapshotInput()),
  ]);
  assert.equal(concurrent.filter((result) => result.replayed === false).length, 1);
  assert.equal(concurrent.filter((result) => result.replayed === true).length, 1);
  const created = concurrent.find((result) => result.replayed === false);
  assert.equal(created.replayed, false);
  assert.equal(created.record.snapshot.status, "CURRENT");
  assert.equal(created.record.snapshot.p50CnyMicros, "20000000");
  assert.equal(created.record.snapshot.sampleCount, 5);
  assert.equal(created.record.quotes.length, 3);
  const gpu = created.record.quotes.find((quote) => quote.productVersionId === "PV-GPU-H100-SXM5-80GB");
  assert.deepEqual(
    { p25: gpu.p25KaiSch, p50: gpu.p50KaiSch, p75: gpu.p75KaiSch, samples: gpu.sampleCount },
    { p25: "1.450000", p50: "1.500000", p75: "1.550000", samples: 5 },
  );
  const rtx4090 = created.record.quotes.find((quote) => quote.productVersionId === "PV-GPU-RTX4090-PCIE-24GB");
  assert.deepEqual(
    { p50: rtx4090.p50KaiSch, samples: rtx4090.sampleCount, label: rtx4090.productLabel },
    { p50: "0.500000", samples: 5, label: "NVIDIA GeForce RTX 4090 24GB" },
    "4090 and H100 in the same region must never share one price distribution",
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM standardization_samples WHERE included_in_index=0").get().count, 4);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM standardization_samples WHERE exclusion_reason='PROMOTIONAL'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM standardization_samples WHERE exclusion_reason='SUPPLY_PILOT'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM standardization_samples WHERE exclusion_reason='STALE_SAMPLE'").get().count, 1);
  assert.deepEqual({ ...db.prepare("SELECT actor_id,reason,event_type FROM standardization_audit_events").get() }, {
    actor_id: "market-index-job",
    reason: "发布每日 KAI 标准卡时行情快照",
    event_type: "SNAPSHOT_PUBLISHED",
  });

  const replay = await store.appendSnapshot(context(), snapshotInput());
  assert.equal(replay.replayed, true);
  await assert.rejects(store.appendSnapshot(context("other-hash"), snapshotInput()), /IDEMPOTENCY_CONFLICT/u);
  await assert.rejects(
    store.appendSnapshot(context("same-asof-other-command", "snapshot-20260808-0002"), snapshotInput()),
    (error) => error?.name === "StandardizationSnapshotConflictError"
      && error.message === "STANDARDIZATION_SNAPSHOT_CONFLICT",
  );
  assert.throws(() => db.prepare("UPDATE standardization_snapshot_batches SET expires_at=?").run("2030-01-01T00:00:00.000Z"), /IMMUTABLE/u);

  const stale = await store.getQuotes(new Date("2026-08-10T00:00:00.000Z"));
  assert.equal(stale.snapshot.status, "STALE");
  assert.equal(stale.quotes.length, 3, "stale values remain observable but are explicitly non-current");
}

test("SQLite stores immutable KAI-SCH snapshots and filters every promotional source", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-standardization-"));
  const path = join(directory, "test.sqlite");
  try {
    const store = await createSqliteStandardizationStore(path, () => NOW);
    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    await assertSnapshotBehavior(store, db);
    db.close();
  } finally {
    try { rmSync(directory, { recursive: true, force: true }); } catch (error) {
      if (error?.code !== "EPERM") throw error;
    }
  }
});

test("D1 adapter returns the same immutable snapshot contract", async () => {
  const target = d1BackedBySqlite();
  const store = await createD1StandardizationStore(target.adapter, () => NOW);
  await assertSnapshotBehavior(store, target.db);
  target.db.close();
});

test("member projection keeps native capacity, KAI-SCH and CNY settlement separate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-standard-account-"));
  const path = join(directory, "test.sqlite");
  try {
    const store = await createSqliteStandardizationStore(path, () => NOW);
    await store.appendSnapshot(context(), snapshotInput());
    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    db.exec(`CREATE TABLE exchange_resource_assets(id TEXT PRIMARY KEY,product_version_id TEXT,product_code TEXT,region TEXT);
      CREATE TABLE exchange_product_capacity_policies(product_version_id TEXT,feature_status TEXT,price_basis_base_units INTEGER);
      CREATE TABLE exchange_capacity_lots(id TEXT PRIMARY KEY,resource_asset_id TEXT,capacity_base_units INTEGER);
      CREATE TABLE exchange_capacity_transfers(capacity_lot_id TEXT,from_bucket TEXT,to_bucket TEXT,capacity_base_units INTEGER);
      CREATE TABLE admin_entity_ownership(source_system TEXT,entity_type TEXT,entity_id TEXT,organization_id TEXT);`);
    db.prepare("INSERT INTO exchange_resource_assets VALUES(?,?,?,?)").run("resource-1", "PV-GPU-H100-SXM5-80GB", "GPU_COMPUTE", "华北");
    db.prepare("INSERT INTO exchange_product_capacity_policies VALUES(?,?,?)").run("PV-GPU-H100-SXM5-80GB", "ENABLED", 3_600);
    db.prepare("INSERT INTO exchange_capacity_lots VALUES(?,?,?)").run("lot-1", "resource-1", 288_000);
    db.prepare("INSERT INTO admin_entity_ownership VALUES('EXCHANGE','CAPACITY_LOT',?,?)").run("lot-1", "org-1");
    const transfer = db.prepare("INSERT INTO exchange_capacity_transfers VALUES(?,?,?,?)");
    transfer.run("lot-1", "ISSUED", "AVAILABLE", 288_000);
    transfer.run("lot-1", "AVAILABLE", "HELD", 3_600);
    transfer.run("lot-1", "AVAILABLE", "HELD", 7_200);
    transfer.run("lot-1", "HELD", "LOCKED", 7_200);
    transfer.run("lot-1", "LOCKED", "IN_SERVICE", 7_200);
    transfer.run("lot-1", "IN_SERVICE", "CONSUMED", 7_200);

    db.prepare("INSERT INTO exchange_resource_assets VALUES(?,?,?,?)").run("resource-2", "PV-GPU-A100-SXM4-80GB", "GPU_COMPUTE", "华北");
    db.prepare("INSERT INTO exchange_product_capacity_policies VALUES(?,?,?)").run("PV-GPU-A100-SXM4-80GB", "ENABLED", 3_600);
    db.prepare("INSERT INTO exchange_capacity_lots VALUES(?,?,?)").run("lot-2", "resource-2", 3_600);
    db.prepare("INSERT INTO admin_entity_ownership VALUES('EXCHANGE','CAPACITY_LOT',?,?)").run("lot-2", "org-2");
    transfer.run("lot-2", "ISSUED", "AVAILABLE", 3_600);

    const account = await store.getAccountProjection("org-1", NOW);
    assert.equal(account.status, "CURRENT");
    assert.deepEqual(account.summary, {
      depositedKaiSch: "120.000000",
      availableKaiSch: "115.500000",
      earnedKaiSch: "0.000000",
      settlementCnyCents: "0",
    }, "consumed capacity is a service state, never supplier income");
    assert.deepEqual(account.income, { pendingCnyCents: "0", payableCnyCents: "0", settledCnyCents: "0" });
    assert.deepEqual(account.positions, [{
      productCode: "GPU_COMPUTE",
      productVersionId: "PV-GPU-H100-SXM5-80GB",
      productLabel: "NVIDIA H100 SXM5 80GB",
      nativeAmount: "80.000000",
      nativeUnitLabel: "卡时",
      availableKaiSch: "115.500000",
      heldKaiSch: "1.500000",
    }]);
    const noCrossModelFallback = await store.getAccountProjection("org-2", NOW);
    assert.equal(noCrossModelFallback.status, "UNAVAILABLE");
    assert.equal(noCrossModelFallback.summary.depositedKaiSch, "0.000000");
    assert.deepEqual(noCrossModelFallback.positions, [], "A100 capacity must not use an H100 quote from the same region");
    db.close();
  } finally {
    try { rmSync(directory, { recursive: true, force: true }); } catch (error) {
      if (error?.code !== "EPERM") throw error;
    }
  }
});
