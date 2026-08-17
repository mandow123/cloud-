import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";

const fixtureInventory = Object.freeze({
  hostnameDigest: `sha256:${"1".repeat(64)}`,
  gpuModel: "RTX_4090",
  gpuUuidDigest: `sha256:${"2".repeat(64)}`,
  gpuMemoryMiB: 24_576,
  driverVersion: "LOCAL-QA",
  cudaVersion: "LOCAL-QA",
  cpuModel: "Local acceptance fixture — not a real GPU",
  memoryMiB: 65_536,
  storageGiB: 2_048,
  publicHost: "local-qa.invalid",
  sshPortStart: 27_000,
  sshPortEnd: 27_019,
});

function restoreEnvironment(name, previous) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

test("production readiness never counts an explicit simulation fixture as an online Agent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-simulation-readiness-"));
  const databasePath = join(directory, "hosting.sqlite");
  const store = await createSqliteHostingV2Store(databasePath);
  const now = new Date();
  const observedAt = now.toISOString();
  const verifiedUntil = new Date(now.getTime() + 60 * 60_000).toISOString();
  const previousEnvironment = process.env.KAI_ENVIRONMENT;
  const previousAcceptance = process.env.KAI_HOSTING_LOCAL_ACCEPTANCE;
  try {
    const database = new DatabaseSync(databasePath);
    database.prepare(`INSERT INTO hosting_v2_devices(
      id,organization_id,account_id,display_name,device_key_id,device_public_key,agent_version,
      inventory_json,inventory_digest,status,verification_status,verification_evidence_digest,
      verified_until,last_sequence,last_seen_at,version,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "had_simulation_readiness",
      "org_simulation_readiness",
      "acct_simulation_readiness",
      "Local acceptance fixture",
      `sha256:${"3".repeat(64)}`,
      "A".repeat(43),
      "1.11.0",
      JSON.stringify(fixtureInventory),
      `sha256:${"4".repeat(64)}`,
      "VERIFIED",
      "PASSED",
      `sha256:${"5".repeat(64)}`,
      verifiedUntil,
      1,
      observedAt,
      1,
      observedAt,
      observedAt,
    );
    database.close();

    process.env.KAI_ENVIRONMENT = "PRODUCTION";
    process.env.KAI_HOSTING_LOCAL_ACCEPTANCE = "1";
    assert.equal((await store.readiness(observedAt)).activeAgentCount, 0);

    process.env.KAI_ENVIRONMENT = "LOCAL";
    process.env.KAI_HOSTING_LOCAL_ACCEPTANCE = "1";
    assert.equal((await store.readiness(observedAt)).activeAgentCount, 1, "the same fixture is usable only for explicit local acceptance");
  } finally {
    restoreEnvironment("KAI_ENVIRONMENT", previousEnvironment);
    restoreEnvironment("KAI_HOSTING_LOCAL_ACCEPTANCE", previousAcceptance);
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
