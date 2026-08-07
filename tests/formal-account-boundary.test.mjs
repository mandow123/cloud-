import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("new demands, supply offers and orders require the formal trading account guard", () => {
  const guardedRoutes = [
    "app/api/requests/route.ts",
    "app/api/v1/supply/offers/route.ts",
    "app/api/v1/checkouts/route.ts",
    "app/api/v1/supply/trial-orders/route.ts",
  ];
  for (const route of guardedRoutes) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /requireTradingAccountSession\(request\)/u, `${route} must require a formal account`);
  }
  const guard = readFileSync("lib/server/entity-ownership.ts", "utf8");
  assert.match(guard, /return requireAccountSession\(request\)/u);
  assert.doesNotMatch(guard, /x-kai-workspace-role/u);
});
