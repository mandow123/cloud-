import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { requireKaiSelfPresetOperator } from "../lib/server/supply-api.ts";

function request(role) {
  return new Request("https://kai.example/api/v1/supply/pools", {
    method: "POST",
    headers: {
      "x-kai-workspace-role": role,
    },
  });
}

test("KAI self preset gate rejects an ordinary supplier without an administrator session", async () => {
  await assert.rejects(
    requireKaiSelfPresetOperator(request("supplier")),
    (error) => error?.code === "ACCOUNT_AUTH_REQUIRED" && error?.status === 401,
  );
});

test("forging the former ops header never grants KAI inventory permission", async () => {
  await assert.rejects(
    requireKaiSelfPresetOperator(request("ops")),
    (error) => error?.code === "ACCOUNT_AUTH_REQUIRED" && error?.status === 401,
  );
  const gate = readFileSync(new URL("../lib/server/supply-api.ts", import.meta.url), "utf8");
  assert.match(gate, /requireAdminPermission\(request, \["KAI_SELF_INVENTORY_WRITE"\]\)/);
  assert.doesNotMatch(gate, /requireSupplyOpsToken/);
});

test("H100 and Mac preset writes use the internal gate while generic offers stay supplier-scoped", () => {
  const poolsRoute = readFileSync(new URL("../app/api/v1/supply/pools/route.ts", import.meta.url), "utf8");
  const macRoute = readFileSync(new URL("../app/api/v1/supply/mac-inventory/batch/route.ts", import.meta.url), "utf8");
  const offersRoute = readFileSync(new URL("../app/api/v1/supply/offers/route.ts", import.meta.url), "utf8");

  assert.match(poolsRoute, /export async function GET[\s\S]*?supplyWorkspaceRole\(request, \["supplier"\]\)/);
  assert.match(poolsRoute, /export async function POST[\s\S]*?await requireKaiSelfPresetOperator\(request\)/);
  assert.match(macRoute, /export async function POST[\s\S]*?await requireKaiSelfPresetOperator\(request\)/);
  assert.match(offersRoute, /supplyWorkspaceRole\(request, \["supplier"\]\)/);
  assert.doesNotMatch(offersRoute, /requireKaiSelfPresetOperator/);
});
