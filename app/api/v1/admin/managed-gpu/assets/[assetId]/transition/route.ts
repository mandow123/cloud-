import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { MANAGED_GPU_ASSET_STATUSES, type ManagedGpuAssetStatus } from "@/lib/managed-gpu";
import { AccountAuthError } from "@/lib/server/account-auth";
import { managedGpuAdminMutation } from "@/lib/server/managed-gpu-admin-api";
import { managedGpuInteger, managedGpuString } from "@/lib/server/managed-gpu-api";
import { requireManagedGpuFeature } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, routeContext: { params: Promise<{ assetId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireManagedGpuFeature();
    const command = await managedGpuAdminMutation(request, ["VERIFICATION_REVIEW"]);
    const toStatus = managedGpuString(command.input, "toStatus", 6, 24) as ManagedGpuAssetStatus;
    if (!(MANAGED_GPU_ASSET_STATUSES as readonly string[]).includes(toStatus)) throw new AccountAuthError("MANAGED_GPU_VALIDATION_ERROR", 400, "资产目标状态无效。");
    const { assetId } = await routeContext.params;
    const result = await (await getManagedGpuStore()).transitionAsset(command.context, assetId, {
      expectedVersion: managedGpuInteger(command.input, "expectedVersion", 1), toStatus,
      evidenceDigest: managedGpuString(command.input, "evidenceDigest", 64, 64),
      agentBindingId: typeof command.input.agentBindingId === "string" && command.input.agentBindingId.trim() ? command.input.agentBindingId.trim() : null,
      verifiedAt: typeof command.input.verifiedAt === "string" ? command.input.verifiedAt : null,
      allocationCount: command.input.allocationCount == null ? null : managedGpuInteger(command.input, "allocationCount", 0, 0),
      processCount: command.input.processCount == null ? null : managedGpuInteger(command.input, "processCount", 0, 0),
    });
    return jsonResponse(result, result.replayed ? 200 : 201, { "idempotency-replayed": String(result.replayed) }, context);
  } catch (error) { return apiErrorResponse(error, undefined, context); }
}
