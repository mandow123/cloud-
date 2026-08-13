import type { HostingDeviceInventory } from "../hosting-v2.ts";

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const NVIDIA_DRIVER_VERSION = /^\d{3,4}\.\d{1,3}(?:\.\d{1,3})?$/u;
const CUDA_VERSION = /^\d{1,2}\.\d{1,2}$/u;
const LOCAL_FIXTURE = /(?:^|[\s_-])(local|fixture|mock|simulat(?:ed|ion)?|fake)(?:[\s_-]|$)/iu;

export function physicalGpuAudit(inventory: HostingDeviceInventory) {
  const expectedMemory = inventory.gpuModel === "RTX_4090" ? 24_000 : inventory.gpuModel === "H100_80GB" ? 80_000 : null;
  const simulated = inventory.publicHost.toLowerCase().endsWith(".invalid")
    || LOCAL_FIXTURE.test(inventory.driverVersion)
    || LOCAL_FIXTURE.test(inventory.cudaVersion)
    || LOCAL_FIXTURE.test(inventory.cpuModel);
  const passed = expectedMemory !== null
    && inventory.gpuMemoryMiB >= expectedMemory
    && SHA256_DIGEST.test(inventory.hostnameDigest)
    && SHA256_DIGEST.test(inventory.gpuUuidDigest)
    && NVIDIA_DRIVER_VERSION.test(inventory.driverVersion)
    && CUDA_VERSION.test(inventory.cudaVersion)
    && !simulated;
  return {
    passed,
    detail: passed
      ? `${inventory.gpuModel} · ${inventory.gpuMemoryMiB} MiB · 驱动 ${inventory.driverVersion} · CUDA ${inventory.cudaVersion}`
      : simulated
        ? "检测到本地协议模拟标记，不能作为真实 GPU 验收。"
        : "GPU 型号、显存、硬件摘要或驱动/CUDA 版本未达到首期真实机验收门槛。",
  } as const;
}

type Environment = Record<string, string | undefined>;

export function gpuTradingEligibility(inventory: HostingDeviceInventory, environment: Environment = typeof process === "undefined" ? {} : process.env) {
  const physical = physicalGpuAudit(inventory);
  if (physical.passed) return { ...physical, localAcceptance: false } as const;
  const explicitLocalFixture = environment.KAI_ENVIRONMENT === "LOCAL"
    && environment.KAI_HOSTING_LOCAL_ACCEPTANCE === "1"
    && inventory.publicHost === "local-qa.invalid"
    && LOCAL_FIXTURE.test(inventory.driverVersion)
    && LOCAL_FIXTURE.test(inventory.cudaVersion)
    && LOCAL_FIXTURE.test(inventory.cpuModel);
  return explicitLocalFixture
    ? { passed: true, localAcceptance: true, detail: "仅限本地闭环验收；不能作为真实 GPU 验收或生产供给。" } as const
    : { ...physical, localAcceptance: false } as const;
}
