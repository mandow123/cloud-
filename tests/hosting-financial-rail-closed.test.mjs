import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  HOSTING_FINANCIAL_RAIL_STATUS,
  isHostingFinancialRailReady,
  readHostingV2TransactionAvailability,
  requireHostingV2TransactionCapability,
} from "../lib/server/hosting-v2-transaction-gate.ts";
import { evaluateHostingV2Capability } from "../lib/server/hosting-v2-readiness.ts";
import { parseHostingTransactionAvailability } from "../lib/hosting-v2-client.ts";

const ROOT = new URL("../", import.meta.url);

test("production Hosting transactions stay closed until the audited ledger V2 exists", async () => {
  assert.equal(HOSTING_FINANCIAL_RAIL_STATUS, "CLOSED_PENDING_LEDGER_V2");
  assert.equal(isHostingFinancialRailReady(), false);
  const availability = await readHostingV2TransactionAvailability();
  assert.deepEqual(availability, {
    ready: false,
    mode: "BROWSE_ONLY",
    failClosed: true,
    reason: "HOSTING_FINANCIAL_RAIL_CLOSED",
    message: "算力交易资金链路正在完成双式账本、退款与收益冲正验收，当前仅开放市场浏览。 ",
  });
  await assert.rejects(
    requireHostingV2TransactionCapability(),
    (error) => error?.code === "HOSTING_FINANCIAL_RAIL_CLOSED" && error?.status === 503,
  );
});

test("public readiness reports the financial rail closure even when every other dependency is healthy", () => {
  const readiness = evaluateHostingV2Capability({
    environment: {
      KAI_HOSTING_V2: "1",
      KAI_HOSTING_APPROVED_IMAGES: `ghcr.io/kai-cloud/cuda-pytorch@sha256:${"a".repeat(64)}`,
      KAI_HOSTING_TERMS_VERSION: "KAI_HOSTING_TERMS_2026_08",
    },
    hostingStorage: { ready: true },
    cardHourStorage: { ready: true },
    operations: {
      schemaVersion: 3,
      integrity: "ok",
      activeFeeScheduleId: "hfee_ready",
      approvedSupplierCount: 1,
      activeAgentCount: 1,
      drainingDeviceCount: 0,
      failedCleanupCount: 0,
      cleaningContractCount: 0,
    },
    kaiIdentityAvailable: true,
    kaiIdentityLoginAudited: true,
    adminPasswordAvailable: true,
    financeApprovalAvailable: true,
    financialRailReady: false,
    alipay: { enabled: false, configured: false, canCreatePayment: false, missing: [], gateway: "", merchantAccountRef: null },
  });
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.checks.financialRail, {
    ready: false,
    failClosed: true,
    reason: "HOSTING_FINANCIAL_RAIL_CLOSED",
  });
});

test("buyer transaction projection fails closed unless the server fact is exact", () => {
  assert.equal(parseHostingTransactionAvailability(undefined).ready, false);
  assert.equal(parseHostingTransactionAvailability({ ready: true, mode: "TRANSACT" }).ready, false);
  assert.deepEqual(parseHostingTransactionAvailability({ ready: true, mode: "TRANSACT", failClosed: true, reason: null, message: "算力交易能力已就绪。" }), {
    ready: true,
    mode: "TRANSACT",
    failClosed: true,
    reason: null,
    message: "算力交易能力已就绪。",
  });
});

test("every buyer contract mutation passes through the financial rail gate", async () => {
  const routes = ["accept", "cancel", "dispute", "ssh-key", "start", "stop"];
  for (const action of routes) {
    const source = await readFile(new URL(`app/api/v2/contracts/[contractId]/${action}/route.ts`, ROOT), "utf8");
    assert.match(source, /await requireHostingV2TransactionCapability\(\)/u, `${action} must fail closed with the financial rail`);
  }
  const collection = await readFile(new URL("app/api/v2/contracts/route.ts", ROOT), "utf8");
  assert.match(collection, /await requireHostingV2TransactionCapability\(\)/u);
});

test("isolated local acceptance can still exercise the protocol without production eligibility", async () => {
  const previousEnvironment = process.env.KAI_ENVIRONMENT;
  const previousAcceptance = process.env.KAI_HOSTING_LOCAL_ACCEPTANCE;
  process.env.KAI_ENVIRONMENT = "LOCAL";
  process.env.KAI_HOSTING_LOCAL_ACCEPTANCE = "1";
  try {
    assert.deepEqual(await readHostingV2TransactionAvailability(), {
      ready: true,
      mode: "TRANSACT",
      failClosed: true,
      reason: null,
      message: "算力交易能力已就绪。",
    });
    await requireHostingV2TransactionCapability();
  } finally {
    if (previousEnvironment === undefined) delete process.env.KAI_ENVIRONMENT;
    else process.env.KAI_ENVIRONMENT = previousEnvironment;
    if (previousAcceptance === undefined) delete process.env.KAI_HOSTING_LOCAL_ACCEPTANCE;
    else process.env.KAI_HOSTING_LOCAL_ACCEPTANCE = previousAcceptance;
  }
});
