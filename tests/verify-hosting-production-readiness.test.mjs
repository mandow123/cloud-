import assert from "node:assert/strict";
import test from "node:test";

import {
  verifyHostingProduction,
  verifyHostingProductionSnapshot,
} from "../scripts/ops/verify-hosting-production-readiness.mjs";

const RELEASE = "8".repeat(40);

function snapshot(stage = "SETUP") {
  const agentConnected = stage !== "SETUP";
  const enabled = stage === "INTERNAL_TRIAL" || stage === "MARKET";
  const ready = { ready: true, failClosed: true };
  return {
    status: "ok",
    check: "ready",
    service: "kai-cloud-marketplace",
    release: RELEASE,
    environment: { localAcceptance: false },
    storage: {
      auth: { ready: true },
      cardHours: { ready: true },
      hostingV2: { ready: true },
    },
    capabilities: {
      kaiIdentityLogin: { available: true },
      alipayLive: { enabled: false, available: false },
    },
    hostingV2: {
      enabled,
      configurationEnabled: true,
      ready: true,
      failClosed: true,
      rolloutMode: enabled ? "INTERNAL_AGENT_TRIAL" : "SETUP",
      fundingMode: "ADMIN_DUAL_CONTROL_TRIAL_GRANTS",
      checks: {
        storage: ready,
        supplierIdentity: ready,
        trialGrantRequest: ready,
        trialGrantApproval: ready,
        agentDelivery: agentConnected ? ready : { ready: false, failClosed: true, reason: "HOSTING_ACTIVE_AGENT_MISSING" },
        feeSchedule: ready,
        cardHourLedger: ready,
        approvedImages: { ...ready, count: 1 },
        supplierTerms: ready,
        metering: agentConnected ? ready : { ready: false, failClosed: true, reason: "HOSTING_METERING_NOT_READY" },
        cleanup: ready,
        alipayClosed: ready,
      },
      operations: {
        schemaVersion: 14,
        integrity: "ok",
        activeFeeScheduleConfigured: true,
        approvedSupplierCount: 1,
        activeAgentCount: agentConnected ? 1 : 0,
        drainingDeviceCount: 0,
        failedCleanupCount: 0,
        cleaningContractCount: 0,
      },
    },
  };
}

test("production gate distinguishes setup, connected Agent, and enabled trial stages", () => {
  for (const stage of ["SETUP", "AGENT_CONNECTED", "INTERNAL_TRIAL", "MARKET"]) {
    const result = verifyHostingProductionSnapshot(snapshot(stage), { stage, expectedRelease: RELEASE });
    assert.equal(result.stage, stage);
    assert.equal(result.activeAgentCount, stage === "SETUP" ? 0 : 1);
  }
});

test("production gate rejects local simulation, cleanup incidents, and a missing Agent", () => {
  assert.throws(
    () => verifyHostingProductionSnapshot({ ...snapshot(), environment: { localAcceptance: true } }),
    /local acceptance/u,
  );
  const failedCleanup = structuredClone(snapshot("INTERNAL_TRIAL"));
  failedCleanup.hostingV2.operations.failedCleanupCount = 1;
  assert.throws(() => verifyHostingProductionSnapshot(failedCleanup, { stage: "INTERNAL_TRIAL" }), /failed cleanup/u);
  assert.throws(
    () => verifyHostingProductionSnapshot(snapshot("SETUP"), { stage: "INTERNAL_TRIAL" }),
    /agent|trial/iu,
  );
});

test("MARKET stage verifies a real public offer response while earlier stages do not", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("/api/ready")) return Response.json(snapshot("MARKET"));
    if (url.endsWith("/api/v2/offers")) return Response.json({ records: [{ id: "hofr_verified" }], count: 1, updatedAt: new Date().toISOString() });
    return new Response(null, { status: 404 });
  };
  const result = await verifyHostingProduction({
    origin: "https://cloud.kai.com",
    stage: "MARKET",
    expectedRelease: RELEASE,
    fetchImpl,
  });
  assert.equal(result.publicOfferCount, 1);
  assert.deepEqual(calls, ["https://cloud.kai.com/api/ready", "https://cloud.kai.com/api/v2/offers"]);

  await assert.rejects(
    verifyHostingProduction({
      origin: "https://cloud.kai.com",
      stage: "MARKET",
      fetchImpl: async (url) => url.endsWith("/api/ready") ? Response.json(snapshot("MARKET")) : Response.json({ records: [], count: 0, updatedAt: new Date().toISOString() }),
    }),
    /no verified public GPU offer/u,
  );
});

test("production gate rejects insecure origins and release drift", async () => {
  await assert.rejects(verifyHostingProduction({ origin: "http://cloud.kai.com" }), /HTTPS origin/u);
  assert.throws(
    () => verifyHostingProductionSnapshot(snapshot(), { expectedRelease: "7".repeat(40) }),
    /Expected release/u,
  );
});
