import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { HOSTING_V2_SCHEMA_VERSION, hostingV2SchemaMigrations } from "../db/hosting-v2-schema.ts";
import { hostingAgentDigest } from "../lib/server/hosting-agent-crypto.ts";
import { createD1HostingV2Store } from "../lib/server/hosting-v2-store-d1.ts";
import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";

const APPROVED_IMAGE = process.env.KAI_HOSTING_APPROVED_IMAGES;
const TERMS_VERSION = process.env.KAI_HOSTING_TERMS_VERSION;

const supplier = {
  account: { id: "acct-h100-94-supplier", displayName: "H100 94GB Supplier", primaryEmail: "h100-94-supplier@example.com", status: "ACTIVE" },
  activeOrganization: { id: "org-h100-94-supplier", name: "H100 94GB Supplier", externalKey: "H100_94_SUPPLIER", status: "ACTIVE" },
  membership: { id: "mbr-h100-94-supplier", accountId: "acct-h100-94-supplier", organizationId: "org-h100-94-supplier", status: "ACTIVE", roles: [] },
  sessionId: "session-h100-94-supplier",
  authMethod: "KAI_IDENTITY_OIDC",
};

const buyer = {
  account: { id: "acct-h100-94-buyer", displayName: "H100 94GB Buyer", primaryEmail: "h100-94-buyer@example.com", status: "ACTIVE" },
  activeOrganization: { id: "org-h100-94-buyer", name: "H100 94GB Buyer", externalKey: "H100_94_BUYER", status: "ACTIVE" },
  membership: { id: "mbr-h100-94-buyer", accountId: "acct-h100-94-buyer", organizationId: "org-h100-94-buyer", status: "ACTIVE", roles: [] },
  sessionId: "session-h100-94-buyer",
  authMethod: "KAI_IDENTITY_OIDC",
};

function mutation(actorId, key, now) {
  return { actorId, idempotencyKey: key, payloadHash: `sha256:${key.padEnd(64, "0").slice(0, 64)}`, now };
}

function h100Inventory() {
  return {
    hostnameDigest: `sha256:${"1".repeat(64)}`,
    gpuModel: "H100_94GB",
    gpuUuidDigest: `sha256:${"2".repeat(64)}`,
    gpuMemoryMiB: 95_830,
    driverVersion: "580.10",
    cudaVersion: "13.0",
    cpuModel: "AMD EPYC 9654",
    memoryMiB: 524_288,
    storageGiB: 4_096,
    publicHost: "h100-nvl.example.com",
    sshPortStart: 23_400,
    sshPortEnd: 23_419,
  };
}

function verificationDetails(inventoryDigest, observedAt, challengeDigest) {
  const tests = ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "WORKLOAD_IMAGE", "PORT_REACHABILITY"];
  return {
    protocolVersion: 1,
    inventoryDigest,
    observedAt,
    tests: tests.map((name, index) => ({
      name,
      status: "PASSED",
      evidenceDigest: `sha256:${String(index + 1).repeat(64)}`,
      ...(name === "WORKLOAD_IMAGE" ? { summary: { protocolVersion: 1, scope: "APPROVED_WORKLOAD_IMAGES", images: [APPROVED_IMAGE], allPresent: true } } : {}),
      ...(name === "PORT_REACHABILITY" ? { summary: { port: 23_400, scope: "CONTROL_PLANE_CHALLENGE", challengeDigest } } : {}),
    })),
  };
}

function createLegacyOfferTable(db) {
  db.exec(`CREATE TABLE hosting_v2_offers (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    fee_schedule_id TEXT NOT NULL,
    title TEXT NOT NULL,
    gpu_model TEXT NOT NULL CHECK (gpu_model IN ('RTX_4090','H100_80GB')),
    region TEXT NOT NULL,
    card_hour_micros_per_gpu_hour INTEGER NOT NULL CHECK (card_hour_micros_per_gpu_hour > 0),
    min_rental_seconds INTEGER NOT NULL CHECK (min_rental_seconds >= 180),
    max_rental_seconds INTEGER NOT NULL CHECK (max_rental_seconds >= min_rental_seconds),
    available_from TEXT NOT NULL,
    available_until TEXT NOT NULL,
    approved_image TEXT NOT NULL,
    terms_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','RESERVED','PAUSED','UNLISTED','SUSPENDED')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

class FakeD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) { return new FakeD1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() { return this.runSync(); }
  runSync() { return { meta: { changes: Number(this.database.prepare(this.sql).run(...this.values).changes) } }; }
}

class FakeD1Database {
  constructor() { this.database = new DatabaseSync(":memory:"); }
  prepare(sql) { return new FakeD1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  close() { this.database.close(); }
}

test("schema 16 H100 94GB migration is mirrored and upgrades a populated schema 15 database", async () => {
  const local = readFileSync(new URL("../drizzle/0030_hosting_h100_94gb.sql", import.meta.url), "utf8");
  const hosted = readFileSync(new URL("../.openai/drizzle/0030_hosting_h100_94gb.sql", import.meta.url), "utf8");
  assert.equal(local, hosted);
  assert.match(local, /gpu_model IN \('RTX_4090','H100_80GB','H100_94GB'\)/u);
  assert.match(local, /VALUES\(16,datetime\('now'\)\)/u);
  assert.equal(HOSTING_V2_SCHEMA_VERSION, 16);
  assert.equal(hostingV2SchemaMigrations.at(-1)?.version, 16);

  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-h100-94-migration-"));
  const databasePath = join(directory, "hosting.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE hosting_v2_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)");
  db.prepare("INSERT INTO hosting_v2_schema_migrations(version,applied_at) VALUES(15,?)").run("2026-08-17T04:00:00.000Z");
  createLegacyOfferTable(db);
  db.prepare(`INSERT INTO hosting_v2_offers(
    id,organization_id,device_id,fee_schedule_id,title,gpu_model,region,card_hour_micros_per_gpu_hour,
    min_rental_seconds,max_rental_seconds,available_from,available_until,approved_image,terms_version,status,version,created_at,updated_at
  ) VALUES(?,?,?,?,?,'H100_80GB','中国·北京',1000000,180,3600,?,?,?,?,'PAUSED',3,?,?)`).run(
    "hofr_legacy_h100_80", "org-legacy", "had-legacy", "hfee-legacy", "保留的 H100 80GB 挂牌",
    "2026-08-17T03:00:00.000Z", "2026-08-18T03:00:00.000Z", APPROVED_IMAGE, TERMS_VERSION,
    "2026-08-17T03:00:00.000Z", "2026-08-17T03:30:00.000Z",
  );
  db.close();

  const store = await createSqliteHostingV2Store(databasePath);
  try {
    const upgraded = new DatabaseSync(databasePath);
    assert.equal(upgraded.prepare("SELECT MAX(version) version FROM hosting_v2_schema_migrations").get().version, 16);
    assert.match(upgraded.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='hosting_v2_offers'").get().sql, /H100_94GB/u);
    assert.deepEqual({ ...upgraded.prepare("SELECT id,gpu_model,status,version FROM hosting_v2_offers").get() }, { id: "hofr_legacy_h100_80", gpu_model: "H100_80GB", status: "PAUSED", version: 3 });
    upgraded.prepare(`INSERT INTO hosting_v2_offers(
      id,organization_id,device_id,fee_schedule_id,title,gpu_model,region,card_hour_micros_per_gpu_hour,
      min_rental_seconds,max_rental_seconds,available_from,available_until,approved_image,terms_version,status,version,created_at,updated_at
    ) SELECT 'hofr_new_h100_94',organization_id,device_id,fee_schedule_id,'新增 H100 94GB','H100_94GB',region,
      card_hour_micros_per_gpu_hour,min_rental_seconds,max_rental_seconds,available_from,available_until,approved_image,terms_version,'DRAFT',1,created_at,updated_at
      FROM hosting_v2_offers WHERE id='hofr_legacy_h100_80'`).run();
    assert.equal(upgraded.prepare("SELECT gpu_model FROM hosting_v2_offers WHERE id='hofr_new_h100_94'").get().gpu_model, "H100_94GB");
    upgraded.close();
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("D1 adapter applies the same schema 15 to 16 H100 94GB migration", async () => {
  const d1 = new FakeD1Database();
  d1.database.exec("CREATE TABLE hosting_v2_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)");
  d1.database.prepare("INSERT INTO hosting_v2_schema_migrations(version,applied_at) VALUES(15,?)").run("2026-08-17T04:00:00.000Z");
  createLegacyOfferTable(d1.database);
  let store;
  try {
    store = await createD1HostingV2Store(d1);
    assert.equal(d1.database.prepare("SELECT MAX(version) version FROM hosting_v2_schema_migrations").get().version, 16);
    assert.match(d1.database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='hosting_v2_offers'").get().sql, /H100_94GB/u);
    d1.database.prepare(`INSERT INTO hosting_v2_offers(
      id,organization_id,device_id,fee_schedule_id,title,gpu_model,region,card_hour_micros_per_gpu_hour,
      min_rental_seconds,max_rental_seconds,available_from,available_until,approved_image,terms_version,status,version,created_at,updated_at
    ) VALUES('hofr_d1_h100_94','org-d1','had-d1','hfee-d1','D1 H100 94GB','H100_94GB','中国·北京',8000000,180,3600,?,?,?,?, 'DRAFT',1,?,?)`).run(
      "2026-08-17T03:00:00.000Z", "2026-08-18T03:00:00.000Z", APPROVED_IMAGE, TERMS_VERSION,
      "2026-08-17T03:00:00.000Z", "2026-08-17T03:00:00.000Z",
    );
    assert.equal(d1.database.prepare("SELECT gpu_model FROM hosting_v2_offers WHERE id='hofr_d1_h100_94'").get().gpu_model, "H100_94GB");
  } finally {
    void store;
    d1.close();
  }
});

test("simulated H100 94GB inventory survives registration, verification, publication and contract snapshot", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-h100-94-loop-"));
  const databasePath = join(directory, "hosting.sqlite");
  const store = await createSqliteHostingV2Store(databasePath);
  try {
    const now = new Date().toISOString();
    await store.saveProfile(supplier, { supplierType: "COMPANY", legalDisplayName: "H100 94GB 模拟供应方", contactEmail: supplier.account.primaryEmail, expectedVersion: 0 }, mutation(supplier.account.id, "h10094-profile-save", now));
    await store.submitProfile(supplier.activeOrganization.id, 1, TERMS_VERSION, mutation(supplier.account.id, "h10094-profile-submit", now));
    await store.reviewProfile(supplier.activeOrganization.id, { decision: "APPROVE", expectedVersion: 2, reviewNote: "H100 94GB 无硬件模拟闭环", evidenceDigest: "c".repeat(64) }, mutation("admin-h10094-review", "h10094-profile-review", now));

    const challenge = await store.issueAgentChallenge(supplier, mutation(supplier.account.id, "h10094-challenge", now));
    const inventory = h100Inventory();
    const inventoryDigest = `sha256:${"3".repeat(64)}`;
    const device = await store.registerDevice(challenge.id, {
      displayName: "H100 NVL 94GB 模拟节点",
      deviceKeyId: `sha256:${"4".repeat(64)}`,
      devicePublicKey: "A".repeat(43),
      agentVersion: "1.11.0",
      inventory,
      inventoryDigest,
    }, mutation("agent-h10094", "h10094-register", now));
    assert.equal(device.inventory.gpuModel, "H100_94GB");
    assert.equal(device.inventory.gpuMemoryMiB, 95_830);

    await store.acceptHeartbeat(device.id, { sequence: 1, inventoryDigest, capacityState: "ONLINE", observedAt: now }, mutation(`agent:${device.id}`, "h10094-heartbeat", now));
    const verification = await store.queueVerification(supplier.activeOrganization.id, device.id, mutation(supplier.account.id, "h10094-verify", now));
    await store.pollCommand(device.id, now);
    const challengeDigest = await hostingAgentDigest({ protocolVersion: 1, deviceId: device.id, commandId: verification.id, publicHost: inventory.publicHost, publicPort: inventory.sshPortStart, challenge: verification.payload.reachabilityChallenge });
    const details = verificationDetails(inventoryDigest, now, challengeDigest);
    await store.completeCommand(device.id, verification.id, { outcome: "SUCCEEDED", evidenceDigest: await hostingAgentDigest(details), controlPlaneReachabilityDigest: challengeDigest, details }, mutation(`agent:${device.id}`, "h10094-verify-complete", now));
    assert.equal((await store.getDevice(device.id)).verificationStatus, "PASSED");

    await store.createFeeSchedule({ platformFeeBps: 1_000, referralRewardBps: 300, activate: true, effectiveFrom: now }, mutation("admin-h10094-market", "h10094-fee", now));
    const offer = await store.createOffer(supplier.activeOrganization.id, {
      deviceId: device.id,
      title: "北京单卡 H100 94GB",
      gpuModel: "H100_94GB",
      region: "中国·北京",
      cardHourMicrosPerGpuHour: 8_000_000,
      minRentalSeconds: 180,
      maxRentalSeconds: 3_600,
      availableFrom: new Date(Date.parse(now) - 60_000).toISOString(),
      availableUntil: new Date(Date.parse(now) + 86_400_000).toISOString(),
      approvedImage: APPROVED_IMAGE,
      termsVersion: TERMS_VERSION,
    }, mutation(supplier.account.id, "h10094-offer-create", now));
    assert.equal(offer.gpuModel, "H100_94GB");

    const published = await store.updateOfferStatus(supplier.activeOrganization.id, offer.id, { status: "PUBLISHED", expectedVersion: 1 }, mutation(supplier.account.id, "h10094-offer-publish", now));
    assert.equal(published.gpuModel, "H100_94GB");
    const publicOffer = await store.getPublicOffer(offer.id, now);
    assert.equal(publicOffer?.gpuModel, "H100_94GB");
    assert.equal((await store.listPublicOffers(now))[0]?.gpuModel, "H100_94GB");

    const contract = await store.reserveContract(buyer, offer.id, published.version, 180, mutation(buyer.account.id, "h10094-contract-reserve", now));
    assert.equal(contract.snapshot.gpuModel, "H100_94GB");
    assert.equal(contract.snapshot.title, "北京单卡 H100 94GB");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("supplier offer form labels H100 94GB exactly and never falls back to 80GB", () => {
  const source = readFileSync("components/supply-offer-create.tsx", "utf8");
  assert.match(source, /H100_94GB: "H100 94GB"/u);
  assert.match(source, /suggestedOfferTitle\(nextDevice\)/u);
  assert.doesNotMatch(source, /gpuModel === "RTX_4090" \? "RTX 4090" : "H100 80GB"/u);
});
