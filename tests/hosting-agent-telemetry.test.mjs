import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { agentVersionAtLeast, parseHostingDeviceInventory } from "../lib/server/hosting-agent-api.ts";
import { hostingAgentDigest, hostingAgentKeyId, verifyHostingAgentSignature } from "../lib/server/hosting-agent-crypto.ts";
import { isAgentTelemetryV1Enabled } from "../lib/server/agent-telemetry-feature.ts";
import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";

const account = {
  account: { id: "acct-telemetry", displayName: "Telemetry Supplier", primaryEmail: "telemetry@example.com", status: "ACTIVE" },
  activeOrganization: { id: "org-telemetry", name: "Telemetry Supplier", externalKey: "TELEMETRY", status: "ACTIVE" },
  membership: { id: "mbr-telemetry", accountId: "acct-telemetry", organizationId: "org-telemetry", status: "ACTIVE", roles: [] },
  sessionId: "session-telemetry",
  authMethod: "KAI_IDENTITY_OIDC",
};

const mutation = (actorId, key, now) => ({ actorId, idempotencyKey: key, payloadHash: `hash-${key}`, now });

async function approve(store, now) {
  await store.saveProfile(account, { supplierType: "INDIVIDUAL", legalDisplayName: "Telemetry Supplier", contactEmail: "telemetry@example.com", expectedVersion: 0 }, mutation(account.account.id, "profile-save", now));
  await store.submitProfile(account.activeOrganization.id, 1, "KAI_HOSTING_TERMS_2026_08", mutation(account.account.id, "profile-submit", now));
  await store.reviewProfile(account.activeOrganization.id, { decision: "APPROVE", expectedVersion: 2, reviewNote: "Telemetry supplier approved", evidenceDigest: "a".repeat(64) }, mutation("admin", "profile-review", now));
}

function seedApplication(path) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE supply_offers(id TEXT PRIMARY KEY,status TEXT NOT NULL,supplier_type TEXT NOT NULL,resource_type TEXT NOT NULL,quantity INTEGER NOT NULL);
    CREATE TABLE admin_entity_ownership(source_system TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,organization_id TEXT NOT NULL,account_id TEXT NOT NULL,PRIMARY KEY(source_system,entity_type,entity_id));`);
  const applicationId = "KAI-SOF-1234567890ABCDEF";
  db.prepare("INSERT INTO supply_offers VALUES(?,?,?,?,?)").run(applicationId, "VERIFIED", "INDIVIDUAL", "GPU_CARD", 1);
  db.prepare("INSERT INTO admin_entity_ownership VALUES('SUPPLY_PILOT','SUPPLY_OFFER',?,?,?)").run(applicationId, account.activeOrganization.id, account.account.id);
  db.close();
  return applicationId;
}

test("Go 1.9.7 handoff registration fixture verifies with the server canonical Ed25519 protocol", async () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/kai-host-agent-go-1.9.7-register.json", import.meta.url), "utf8"));
  const { source, signature, ...payload } = fixture;
  assert.match(source, /1\.9\.7-go\.1/u);
  assert.equal(payload.agentVersion, "1.9.7");
  assert.equal(agentVersionAtLeast("1.9.7-go.1", "1.9.7"), true, "the shipped Go semantic suffix remains protocol-compatible");
  assert.equal(await hostingAgentDigest(payload.inventory), payload.inventoryDigest);
  await assert.doesNotReject(verifyHostingAgentSignature(payload.devicePublicKey, payload, signature));
});

test("0032 migrates an existing v14 database without changing FULL_HOST records", () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-telemetry-migration-"));
  const path = join(directory, "v14.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE hosting_v2_agent_challenges(
      id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,account_id TEXT NOT NULL,nonce TEXT NOT NULL,
      minimum_agent_version TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL);
      CREATE TABLE hosting_v2_devices(
      id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,account_id TEXT NOT NULL,display_name TEXT NOT NULL,
      device_key_id TEXT NOT NULL,device_public_key TEXT NOT NULL,agent_version TEXT NOT NULL,inventory_json TEXT NOT NULL,
      inventory_digest TEXT NOT NULL,status TEXT NOT NULL,verification_status TEXT NOT NULL,last_sequence INTEGER NOT NULL,
      version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
    db.prepare("INSERT INTO hosting_v2_agent_challenges VALUES(?,?,?,?,?,?,NULL,?)").run("hac-old", "org-old", "acct-old", "nonce-old", "1.9.7", "2026-08-21T09:00:00.000Z", "2026-08-21T08:00:00.000Z");
    db.prepare("INSERT INTO hosting_v2_devices VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("had-old", "org-old", "acct-old", "Old host", "key-old", "public-old", "1.9.7", "{}", "sha256:old", "ONLINE", "NOT_RUN", 0, 1, "2026-08-21T08:00:00.000Z", "2026-08-21T08:00:00.000Z");
    const migration = readFileSync(new URL("../drizzle/0032_hosting_agent_capability_modes.sql", import.meta.url), "utf8");
    const mirror = readFileSync(new URL("../.openai/drizzle/0032_hosting_agent_capability_modes.sql", import.meta.url), "utf8");
    assert.equal(mirror, migration);
    db.exec(migration);
    assert.deepEqual({ ...db.prepare("SELECT id,application_id,capability_mode FROM hosting_v2_agent_challenges").get() }, { id: "hac-old", application_id: null, capability_mode: "FULL_HOST" });
    assert.deepEqual({ ...db.prepare("SELECT id,application_id,capability_mode FROM hosting_v2_devices").get() }, { id: "had-old", application_id: null, capability_mode: "FULL_HOST" });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("telemetry challenge is application-bound, capacity-limited, heartbeat-capable and control-plane inert", async () => {
  const previous = process.env.KAI_AGENT_TELEMETRY_V1;
  process.env.KAI_AGENT_TELEMETRY_V1 = "1";
  const directory = mkdtempSync(join(tmpdir(), "kai-telemetry-"));
  const path = join(directory, "test.sqlite");
  const store = await createSqliteHostingV2Store(path);
  try {
    const now = "2026-08-21T08:00:00.000Z";
    await approve(store, now);
    const applicationId = seedApplication(path);
    assert.deepEqual(await store.telemetryEligibleApplicationIds(account.activeOrganization.id, [applicationId], now), [applicationId]);
    assert.deepEqual(await store.telemetryEligibleApplicationIds("org-other", [applicationId], now), []);

    const challenge = await store.issueAgentChallenge(account, mutation(account.account.id, "telemetry-challenge", now), { applicationId, capabilityMode: "TELEMETRY_ONLY" });
    assert.equal(challenge.applicationId, applicationId);
    assert.equal(challenge.capabilityMode, "TELEMETRY_ONLY");
    assert.deepEqual(await store.telemetryEligibleApplicationIds(account.activeOrganization.id, [applicationId], now), [], "an active challenge reserves the declared device quantity");
    await assert.rejects(store.issueAgentChallenge(account, mutation(account.account.id, "telemetry-over-capacity", now), { applicationId, capabilityMode: "TELEMETRY_ONLY" }));

    const fixture = JSON.parse(readFileSync(new URL("./fixtures/kai-host-agent-go-1.9.7-register.json", import.meta.url), "utf8"));
    const inventory = parseHostingDeviceInventory(fixture.inventory);
    const registrationInput = {
      displayName: fixture.displayName,
      deviceKeyId: await hostingAgentKeyId(fixture.devicePublicKey),
      devicePublicKey: fixture.devicePublicKey,
      agentVersion: fixture.agentVersion,
      inventory,
      inventoryDigest: fixture.inventoryDigest,
    };
    delete process.env.KAI_AGENT_TELEMETRY_V1;
    await assert.rejects(store.registerDevice(challenge.id, registrationInput, mutation(`agent:${fixture.devicePublicKey}`, "telemetry-register-disabled", now)), (error) => error.code === "EXCHANGE_NOT_FOUND");
    process.env.KAI_AGENT_TELEMETRY_V1 = "1";
    const device = await store.registerDevice(challenge.id, {
      ...registrationInput,
    }, mutation(`agent:${fixture.devicePublicKey}`, "telemetry-register", now));
    assert.equal(device.applicationId, applicationId);
    assert.equal(device.capabilityMode, "TELEMETRY_ONLY");

    const heartbeatAt = "2026-08-21T08:00:30.000Z";
    const heartbeat = await store.acceptHeartbeat(device.id, { sequence: 1, inventoryDigest: device.inventoryDigest, capacityState: "ONLINE", observedAt: heartbeatAt }, mutation(`agent:${device.id}`, "heartbeat:1", heartbeatAt));
    assert.equal(heartbeat.lastSequence, 1);
    assert.equal(await store.pollCommand(device.id, heartbeatAt), null);
    await assert.rejects(store.queueVerification(account.activeOrganization.id, device.id, mutation(account.account.id, "telemetry-verify", heartbeatAt)), (error) => error.code === "EXCHANGE_ROLE_FORBIDDEN");

    delete process.env.KAI_AGENT_TELEMETRY_V1;
    assert.equal(isAgentTelemetryV1Enabled(), false);
    assert.deepEqual(await store.telemetryEligibleApplicationIds(account.activeOrganization.id, [applicationId], heartbeatAt), []);
    const continued = await store.acceptHeartbeat(device.id, { sequence: 2, inventoryDigest: device.inventoryDigest, capacityState: "ONLINE", observedAt: heartbeatAt }, mutation(`agent:${device.id}`, "heartbeat:2", heartbeatAt));
    assert.equal(continued.lastSequence, 2, "disabling enrollment does not destroy existing telemetry heartbeat history");
  } finally {
    store.close();
    if (previous === undefined) delete process.env.KAI_AGENT_TELEMETRY_V1; else process.env.KAI_AGENT_TELEMETRY_V1 = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
