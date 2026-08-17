import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";

test("schema 15 Gateway binding migration is mirrored, additive and registers its version", () => {
  const local = readFileSync(new URL("../drizzle/0029_hosting_gateway_bindings.sql", import.meta.url), "utf8");
  const hosted = readFileSync(new URL("../.openai/drizzle/0029_hosting_gateway_bindings.sql", import.meta.url), "utf8");
  assert.equal(local, hosted);
  assert.match(local, /CREATE TABLE IF NOT EXISTS hosting_v2_gateway_bindings/u);
  assert.match(local, /hosting_v2_gateway_binding_status_forward_only/u);
  assert.match(local, /VALUES\(15,datetime\('now'\)\)/u);
  assert.doesNotMatch(local, /\bDROP\b|\bDELETE\s+FROM\b|\bALTER\s+TABLE\s+\w+\s+DROP\b/iu);
});

test("Hosting persists one immutable Gateway binding per contract across control-plane restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-hosting-binding-"));
  const databasePath = join(directory, "hosting.sqlite");
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  let store = await createSqliteHostingV2Store(databasePath);
  store.close();
  const db = new DatabaseSync(databasePath);
  db.prepare(`INSERT INTO hosting_v2_contracts(
    id,offer_id,device_id,buyer_organization_id,buyer_account_id,supplier_organization_id,fee_schedule_id,snapshot_json,
    reserved_seconds,held_micros,status,idempotency_key,payload_hash,version,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,'PROVISIONING',?,?,1,?,?)`).run(
    "hctr_binding", "hofr_binding", "had_binding", "org_buyer", "acct_buyer", "org_supplier", "hfee_binding", "{}",
    180, 1000, "binding-idempotency", "binding-payload", now, now,
  );
  db.close();
  try {
    store = await createSqliteHostingV2Store(databasePath);
    const created = await store.recordGatewayLease({ contractId: "hctr_binding", deviceId: "had_binding", leaseId: "hgw_binding", buyerEndpoint: "gateway.example.com:22000", expiresAt }, now);
    assert.equal(created.status, "LEASE_CREATED");
    assert.equal(await store.gatewayBinding("hctr_never_created"), null, "absence is durable proof that no lease binding was recorded");
    store.close();

    store = await createSqliteHostingV2Store(databasePath);
    assert.equal((await store.gatewayBinding("hctr_binding")).leaseId, "hgw_binding");
    assert.equal((await store.markGatewaySlotConfirmed("hctr_binding", new Date().toISOString())).status, "SLOT_CONFIRMED");
    assert.equal((await store.markGatewayRevocationRequired("hctr_binding", "ACCESS_GATEWAY_TIMEOUT", new Date().toISOString())).status, "REVOCATION_REQUIRED");
    store.close();

    store = await createSqliteHostingV2Store(databasePath);
    const recovered = await store.gatewayBinding("hctr_binding");
    assert.equal(recovered.status, "REVOCATION_REQUIRED");
    assert.equal(recovered.lastErrorCode, "ACCESS_GATEWAY_TIMEOUT");
    assert.equal((await store.markGatewayRevoked("hctr_binding", new Date().toISOString())).status, "REVOKED");
  } finally {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
