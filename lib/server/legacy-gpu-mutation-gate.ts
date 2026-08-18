import { AccountAuthError } from "@/lib/server/account-auth";

export type LegacyGpuMutationMode = "COMPATIBILITY" | "LAB";

/**
 * Legacy GPU commerce is read-only outside an explicitly enabled local simulator.
 * Production must remain closed even if a simulation flag is accidentally copied.
 */
export function requireLegacyGpuMutationSimulation(mode: LegacyGpuMutationMode = "COMPATIBILITY") {
  const local = process.env.KAI_ENVIRONMENT === "LOCAL";
  const explicitlyEnabled = mode === "LAB"
    ? process.env.KAI_GPU_LAB_ENABLED === "1"
    : process.env.KAI_LEGACY_GPU_MUTATION_SIMULATION === "1";

  if (!local || !explicitlyEnabled) {
    throw new AccountAuthError(
      "LEGACY_GPU_MUTATION_CLOSED",
      503,
      "旧版 GPU 成交写入已关闭；请通过 /api/v2/contracts 创建正式合同。",
    );
  }
}
