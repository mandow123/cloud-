import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const file=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
test("admin routes use formal permission authentication",()=>{for(const path of ["app/api/v1/admin/_shared.ts","app/api/v1/admin/dashboard/route.ts","app/api/v1/admin/work-items/route.ts","app/api/v1/admin/search/route.ts","app/api/v1/admin/refund-cases/route.ts"]){const source=file(path);if(path.endsWith("_shared.ts"))assert.match(source,/requireAdminPermission/);else assert.match(source,/admin(Read|Write)/);assert.doesNotMatch(source,/x-admin-role|ALLOW_ADMIN|temporary allow/iu);}});
test("payment administration is read-only and approved refunds execute through the separate dual-control route",()=>{const payment=file("app/api/v1/admin/payments/route.ts");assert.match(payment,/export async function GET/);assert.doesNotMatch(payment,/export async function (POST|PATCH|PUT|DELETE)/);assert.doesNotMatch(payment,/CAPTURED|payment success|manual/iu);const refund=file("app/api/v1/admin/refund-cases/[id]/decision/route.ts");assert.match(refund,/REFUND_APPROVE/);assert.match(refund,/decideAndExecuteRefund/);const legacy=file("app/api/v1/orders/[id]/refunds/route.ts");assert.match(legacy,/REFUND_APPROVAL_REQUIRED/);assert.doesNotMatch(legacy,/KAI_SUPPLY_OPS_TOKEN|requireSupplyOpsToken|refundAlipayTrade/);});
test("administrator management is read-only after password-only Root cutover",()=>{
  const collection=file("app/api/v1/admin/principals/route.ts");assert.match(collection,/export async function GET/);assert.doesNotMatch(collection,/export async function (POST|PATCH|PUT|DELETE)|invitePrincipal|ROOT_CONTROL/);
  assert.equal(existsSync(new URL("../app/api/v1/admin/principals/[id]/status/route.ts",import.meta.url)),false);
  assert.equal(existsSync(new URL("../app/api/v1/admin/principals/[id]/roles/route.ts",import.meta.url)),false);
});

test("administrator read routes cover every persisted lifecycle domain with server-side permissions", () => {
  const routes = new Map([
    ["capacity-lots", "MARKET_READ"],
    ["listings", "MARKET_READ"],
    ["withdrawals", "MARKET_READ"],
    ["swaps", "MARKET_READ"],
    ["delivery", "FULFILLMENT_READ"],
    ["metering", "FULFILLMENT_READ"],
    ["settlements", "PAYMENT_READ"],
    ["commissions", "PAYMENT_READ"],
    ["exceptions", "ADMIN_PANEL_READ"],
  ]);
  for (const [route, permission] of routes) {
    const source = file(`app/api/v1/admin/${route}/route.ts`);
    assert.match(source, /export async function GET/u);
    assert.match(source, /adminRead/u);
    assert.match(source, new RegExp(permission, "u"));
    assert.doesNotMatch(source, /x-kai-workspace-role|x-admin-role|ALLOW_ADMIN/iu);
  }
  const standardization = file("app/api/v1/admin/standardization/snapshots/route.ts");
  assert.match(standardization, /export async function GET/u);
  assert.match(standardization, /MARKET_READ/u);
  assert.match(standardization, /export async function POST/u);
  assert.match(standardization, /MARKET_PUBLISH/u);
});
