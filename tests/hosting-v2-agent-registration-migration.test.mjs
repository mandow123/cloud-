import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("agent registration migration is additive, immutable and identical for both runtimes", () => {
  const local = readFileSync(new URL("../drizzle/0025_hosting_agent_registration.sql", import.meta.url), "utf8");
  const hosted = readFileSync(new URL("../.openai/drizzle/0025_hosting_agent_registration.sql", import.meta.url), "utf8");
  assert.equal(local, hosted);
  assert.match(local, /CREATE TABLE IF NOT EXISTS hosting_v2_agent_registrations/u);
  assert.match(local, /challenge_id TEXT PRIMARY KEY/u);
  assert.match(local, /device_id TEXT NOT NULL UNIQUE/u);
  assert.match(local, /immutable_update/u);
  assert.match(local, /immutable_delete/u);
  assert.match(local, /VALUES\(10,datetime\('now'\)\)/u);
  assert.doesNotMatch(local, /\bDROP\b|\bDELETE\s+FROM\b|\bALTER\s+TABLE\s+\w+\s+DROP\b/iu);
});
