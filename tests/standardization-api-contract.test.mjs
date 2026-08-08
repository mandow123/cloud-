import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/v1/admin/standardization/snapshots/route.ts", import.meta.url), "utf8");

test("standardization publishing is server-authorized, idempotent and maps expected errors", () => {
  assert.match(route, /requireAdminPermission\(request, \["MARKET_PUBLISH"\]\)/u);
  assert.match(route, /requireIdempotencyKey\(request\)/u);
  assert.match(route, /payloadHash: await mutationHash\(body\)/u);
  assert.match(route, /actorId: auth\.principal\.id/u);
  assert.match(route, /"actorId" in values \|\| "payloadHash" in values/u);
  assert.match(route, /StandardizationInputError[\s\S]*VALIDATION_ERROR/u);
  assert.match(route, /StandardizationIdempotencyError[\s\S]*IDEMPOTENCY_CONFLICT/u);
  assert.match(route, /StandardizationSnapshotConflictError[\s\S]*SNAPSHOT_CONFLICT/u);
  assert.doesNotMatch(route, /values\.actorId|values\.payloadHash/u);
});
