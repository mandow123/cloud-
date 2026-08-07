import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/v1/supply/offers/route.ts", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../app/api/v1/supply/dashboard/route.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../drizzle/0013_supply_offers.sql", import.meta.url), "utf8");

test("supply offers API is supplier-scoped, parsed server-side and idempotent", () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /supplyWorkspaceRole\(request, \["supplier"\]\)/);
  assert.match(route, /parseCreateSupplyOffer\(await readJsonBody\(request\)\)/);
  assert.match(route, /requireIdempotencyKey\(request\)/);
  assert.match(route, /listOffers\(actor\.id\)/);
  assert.match(route, /createOffer/);
  assert.match(dashboard, /offers/);
});

test("supply offer migration enforces private review states and unit pairing", () => {
  assert.match(migration, /'DRAFT','SUBMITTED','UNDER_VERIFICATION','VERIFIED','REJECTED','PUBLISHED'/);
  assert.match(migration, /resource_type='NAS_STORAGE'.*quantity_unit='TIB'.*pricing_unit='TIB_HOUR'/s);
  assert.match(migration, /resource_type='RACK_CAPACITY'.*quantity_unit='RACK'.*pricing_unit='RACK_MONTH'.*quantity_unit='KW'.*pricing_unit='KW_MONTH'/s);
  assert.doesNotMatch(migration, /KAI_SELF/);
});
