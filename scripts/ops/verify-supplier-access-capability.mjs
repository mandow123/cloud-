#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const supplierAccessAcceptanceManifest = Object.freeze({
  attestationVersion: 1,
  kind: "KAI_SUPPLIER_ACCESS_ACCEPTANCE",
  simulation: true,
  productionReadinessEligible: false,
  suites: Object.freeze([
    "tests/supplier-access-capability.test.mjs",
    "tests/access-gateway.test.mjs",
    "tests/hosting-v2-golden-loop.test.mjs",
    "tests/hosting-v2-simulation-readiness.test.mjs",
    "tests/verify-hosting-production-readiness.test.mjs",
  ]),
  gates: Object.freeze([
    Object.freeze({ id: "SIGNED_DEVICE_REGISTRATION_PROTOCOL", suite: "tests/hosting-v2-golden-loop.test.mjs" }),
    Object.freeze({ id: "OUTBOUND_GATEWAY_TUNNEL", suite: "tests/access-gateway.test.mjs" }),
    Object.freeze({ id: "BUYER_END_TO_END_BYTE_TRANSFER", suite: "tests/access-gateway.test.mjs" }),
    Object.freeze({ id: "REVOCATION_CLOSES_ACCESS", suite: "tests/access-gateway.test.mjs" }),
    Object.freeze({ id: "HOSTING_GOLDEN_ORDER_STATE_MACHINE", suite: "tests/hosting-v2-golden-loop.test.mjs" }),
    Object.freeze({ id: "SIMULATION_EXCLUDED_FROM_PRODUCTION_READINESS", suite: "tests/hosting-v2-simulation-readiness.test.mjs" }),
    Object.freeze({ id: "PRODUCTION_READINESS_CONTRACT", suite: "tests/verify-hosting-production-readiness.test.mjs" }),
  ]),
});

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

export function assertSupplierAccessSimulationBoundary({ argv = [], environment = {} } = {}) {
  invariant(argv.length === 1 && argv[0] === "--simulation", "SUPPLIER_ACCESS_SIMULATION_ACK_REQUIRED");
  invariant((environment.KAI_ENVIRONMENT ?? "").trim().toUpperCase() !== "PRODUCTION", "SUPPLIER_ACCESS_SIMULATION_PRODUCTION_FORBIDDEN");
  invariant((environment.NODE_ENV ?? "").trim().toLowerCase() !== "production", "SUPPLIER_ACCESS_SIMULATION_PRODUCTION_FORBIDDEN");
  return Object.freeze({ simulation: true, productionReadinessEligible: false });
}

function isolatedTestEnvironment(environment) {
  const inherited = Object.fromEntries([
    "PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "CI",
  ].flatMap((name) => typeof environment[name] === "string" ? [[name, environment[name]]] : []));
  return {
    ...inherited,
    NODE_ENV: "test",
    KAI_ENVIRONMENT: "LOCAL",
    KAI_HOSTING_LOCAL_ACCEPTANCE: "1",
    KAI_HOSTING_LOCAL_REACHABILITY_SIMULATION: "1",
    KAI_SUPPLIER_ACCESS_SIMULATION: "1",
  };
}

function runNodeTestSuites(suites, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--experimental-transform-types",
      "--import", "./tests/setup.mjs",
      "--test",
      ...suites,
    ], {
      cwd: REPOSITORY_ROOT,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`SUPPLIER_ACCESS_ACCEPTANCE_INTERRUPTED_${signal}`));
      else resolve(code ?? 1);
    });
  });
}

export async function runSupplierAccessSimulationAcceptance({
  argv = process.argv.slice(2),
  environment = process.env,
  runTestSuites = runNodeTestSuites,
} = {}) {
  assertSupplierAccessSimulationBoundary({ argv, environment });
  const testEnvironment = isolatedTestEnvironment(environment);
  const exitCode = await runTestSuites(supplierAccessAcceptanceManifest.suites, testEnvironment);
  invariant(exitCode === 0, `SUPPLIER_ACCESS_ACCEPTANCE_FAILED_${exitCode}`);
  return Object.freeze({
    event: "supplier_access_acceptance.completed",
    status: "PASS",
    attestationVersion: supplierAccessAcceptanceManifest.attestationVersion,
    simulation: true,
    productionReadinessEligible: false,
    verifiedGates: Object.freeze(supplierAccessAcceptanceManifest.gates.map((gate) => gate.id)),
  });
}

async function main() {
  assertSupplierAccessSimulationBoundary({ argv: process.argv.slice(2), environment: process.env });
  process.stdout.write(`${JSON.stringify({
    event: "supplier_access_acceptance.started",
    simulation: true,
    productionReadinessEligible: false,
    suites: supplierAccessAcceptanceManifest.suites,
  })}\n`);
  const result = await runSupplierAccessSimulationAcceptance();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`SUPPLIER_ACCESS_ACCEPTANCE_FAILED: ${error instanceof Error ? error.message : "Unknown failure"}\n`);
    process.exitCode = 1;
  });
}
