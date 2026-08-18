import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  hostingServiceScopeForRequest,
  hostingServiceScopesForFacts,
} from "../lib/server/hosting-service-scopes.ts";

function request(path, method = "GET") {
  return new Request(`https://cloud.kai.com${path}`, { method });
}

test("Hosting V2 routes map to one server-owned service scope", () => {
  for (const [path, method, expected] of [
    ["/api/v2/contracts", "POST", "BUY"],
    ["/api/v2/contracts/hctr_1/start", "POST", "BUY"],
    ["/api/v2/supply/profile", "PUT", "REGISTER"],
    ["/api/v2/supply/dashboard", "GET", "REGISTER"],
    ["/api/v2/supply/offers", "GET", "REGISTER"],
    ["/api/v2/supply/offers", "POST", "PUBLISH"],
    ["/api/v2/supply/offers/hofr_1/status", "POST", "PUBLISH"],
    ["/api/v2/supply/agent-challenges", "POST", "PUBLISH"],
    ["/api/v2/supply/agent-challenges/hac_1", "GET", "REGISTER"],
    ["/api/v2/supply/devices/had_1/verify", "POST", "PUBLISH"],
    ["/api/v2/supply/contracts", "GET", "FULFILL"],
    ["/api/v2/supply/earnings", "GET", "FINANCE_READ"],
  ]) assert.equal(hostingServiceScopeForRequest(request(path, method)), expected, `${method} ${path}`);
  assert.equal(hostingServiceScopeForRequest(request("/api/v2/offers")), null);
  assert.equal(hostingServiceScopeForRequest(request("/api/v1/demands", "POST")), null);
});

test("ordinary members can onboard and buy while approved suppliers gain publish, fulfilment and finance scopes", () => {
  assert.deepEqual(hostingServiceScopesForFacts({ supplierApproved: false }), ["REGISTER", "BUY"]);
  assert.deepEqual(hostingServiceScopesForFacts({ supplierApproved: true }), ["REGISTER", "BUY", "PUBLISH", "FULFILL", "FINANCE_READ"]);
});

test("all scoped Hosting routes authenticate through the central trading guard", () => {
  for (const path of [
    "app/api/v2/contracts/route.ts",
    "app/api/v2/supply/profile/route.ts",
    "app/api/v2/supply/agent-challenges/route.ts",
    "app/api/v2/supply/offers/route.ts",
    "app/api/v2/supply/contracts/route.ts",
    "app/api/v2/supply/earnings/route.ts",
  ]) {
    assert.match(readFileSync(path, "utf8"), /requireTradingAccountSession\(request\)/u, path);
  }
  const guard = readFileSync("lib/server/entity-ownership.ts", "utf8");
  assert.match(guard, /hostingServiceScopeForRequest\(request\)/u);
  assert.match(guard, /requireHostingServiceScope\(account, hostingScope\)/u);
});
