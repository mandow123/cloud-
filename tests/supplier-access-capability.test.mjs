import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSupplierAccessSimulationBoundary,
  runSupplierAccessSimulationAcceptance,
  supplierAccessAcceptanceManifest,
} from "../scripts/ops/verify-supplier-access-capability.mjs";

test("supplier access acceptance names every jointly verified capability and is explicitly simulation-only", () => {
  assert.equal(supplierAccessAcceptanceManifest.kind, "KAI_SUPPLIER_ACCESS_ACCEPTANCE");
  assert.equal(supplierAccessAcceptanceManifest.simulation, true);
  assert.equal(supplierAccessAcceptanceManifest.productionReadinessEligible, false);
  assert.deepEqual(supplierAccessAcceptanceManifest.gates.map((gate) => gate.id), [
    "SIGNED_DEVICE_REGISTRATION_PROTOCOL",
    "OUTBOUND_GATEWAY_TUNNEL",
    "BUYER_END_TO_END_BYTE_TRANSFER",
    "REVOCATION_CLOSES_ACCESS",
    "HOSTING_GOLDEN_ORDER_STATE_MACHINE",
    "SIMULATION_EXCLUDED_FROM_PRODUCTION_READINESS",
    "PRODUCTION_READINESS_CONTRACT",
  ]);
  for (const gate of supplierAccessAcceptanceManifest.gates) {
    assert.ok(supplierAccessAcceptanceManifest.suites.includes(gate.suite), `${gate.id} must reference an executed suite`);
  }
});

test("supplier access acceptance refuses missing acknowledgement and production environments", () => {
  assert.throws(() => assertSupplierAccessSimulationBoundary(), /SIMULATION_ACK_REQUIRED/u);
  assert.throws(
    () => assertSupplierAccessSimulationBoundary({ argv: ["--simulation"], environment: { KAI_ENVIRONMENT: "PRODUCTION" } }),
    /PRODUCTION_FORBIDDEN/u,
  );
  assert.throws(
    () => assertSupplierAccessSimulationBoundary({ argv: ["--simulation"], environment: { NODE_ENV: "production", KAI_ENVIRONMENT: "LOCAL" } }),
    /PRODUCTION_FORBIDDEN/u,
  );
  assert.doesNotThrow(() => assertSupplierAccessSimulationBoundary({ argv: ["--simulation"], environment: {} }));
});

test("supplier access acceptance pins its child suites to isolated local simulation", async () => {
  let observed;
  const result = await runSupplierAccessSimulationAcceptance({
    argv: ["--simulation"],
    environment: { UNRELATED_SETTING: "preserved" },
    runTestSuites: async (suites, environment) => {
      observed = { suites, environment };
      return 0;
    },
  });
  assert.deepEqual(observed.suites, supplierAccessAcceptanceManifest.suites);
  assert.equal(observed.environment.NODE_ENV, "test");
  assert.equal(observed.environment.KAI_ENVIRONMENT, "LOCAL");
  assert.equal(observed.environment.KAI_HOSTING_LOCAL_ACCEPTANCE, "1");
  assert.equal(observed.environment.KAI_HOSTING_LOCAL_REACHABILITY_SIMULATION, "1");
  assert.equal(observed.environment.KAI_SUPPLIER_ACCESS_SIMULATION, "1");
  assert.equal(observed.environment.UNRELATED_SETTING, undefined, "production-adjacent settings must not leak into the simulation process");
  assert.equal(result.status, "PASS");
  assert.equal(result.simulation, true);
  assert.equal(result.productionReadinessEligible, false);
});

test("supplier access acceptance never emits a passing attestation after a failed suite", async () => {
  await assert.rejects(runSupplierAccessSimulationAcceptance({
    argv: ["--simulation"],
    environment: {},
    runTestSuites: async () => 2,
  }), /ACCEPTANCE_FAILED_2/u);
});
