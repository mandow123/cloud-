import assert from "node:assert/strict";
import test from "node:test";

import { gpuTradingEligibility, physicalGpuAudit } from "../lib/server/hosting-v2-audit-policy.ts";

const realLookingInventory = {
  hostnameDigest: `sha256:${"1".repeat(64)}`,
  gpuModel: "RTX_4090",
  gpuUuidDigest: `sha256:${"2".repeat(64)}`,
  gpuMemoryMiB: 24_576,
  driverVersion: "580.10",
  cudaVersion: "13.0",
  cpuModel: "AMD Ryzen 9 9950X",
  memoryMiB: 65_536,
  storageGiB: 2_048,
  publicHost: "gpu-4090.supplier.example.com",
  sshPortStart: 27_000,
  sshPortEnd: 27_019,
};

test("real-machine audit accepts a supported GPU with production-shaped hardware evidence", () => {
  assert.deepEqual(physicalGpuAudit(realLookingInventory), {
    passed: true,
    detail: "RTX_4090 · 24576 MiB · 驱动 580.10 · CUDA 13.0",
  });
});

test("real-machine audit rejects the explicit local protocol fixture", () => {
  const result = physicalGpuAudit({
    ...realLookingInventory,
    driverVersion: "LOCAL-QA",
    cudaVersion: "LOCAL-QA",
    cpuModel: "Local protocol fixture — not a real GPU",
    publicHost: "local-qa.invalid",
  });
  assert.equal(result.passed, false);
  assert.match(result.detail, /本地协议模拟标记/u);
});

test("local fixtures can transact only inside the explicit LOCAL acceptance deployment", () => {
  const fixture = {
    ...realLookingInventory,
    driverVersion: "LOCAL-QA",
    cudaVersion: "LOCAL-QA",
    cpuModel: "Local protocol fixture — not a real GPU",
    publicHost: "local-qa.invalid",
  };
  assert.equal(gpuTradingEligibility(fixture, { KAI_ENVIRONMENT: "PRODUCTION", KAI_HOSTING_LOCAL_ACCEPTANCE: "1" }).passed, false);
  assert.equal(gpuTradingEligibility(fixture, { KAI_ENVIRONMENT: "LOCAL" }).passed, false);
  assert.deepEqual(gpuTradingEligibility(fixture, { KAI_ENVIRONMENT: "LOCAL", KAI_HOSTING_LOCAL_ACCEPTANCE: "1" }), {
    passed: true,
    localAcceptance: true,
    detail: "仅限本地闭环验收；不能作为真实 GPU 验收或生产供给。",
  });
});

test("real-machine audit rejects incomplete physical specifications", () => {
  const result = physicalGpuAudit({ ...realLookingInventory, gpuMemoryMiB: 16_384 });
  assert.equal(result.passed, false);
  assert.match(result.detail, /未达到首期真实机验收门槛/u);
});
