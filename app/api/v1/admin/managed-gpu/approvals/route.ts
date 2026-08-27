import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { accountAuthDigest, AccountAuthError } from "@/lib/server/account-auth";
import { requireAdminPermission } from "@/lib/server/admin-auth";
import type { ManagedGpuApprovalAction } from "@/lib/server/managed-gpu-store";
import { MANAGED_GPU_APPROVAL_PERMISSIONS, managedGpuAdminMutation } from "@/lib/server/managed-gpu-admin-api";
import { managedGpuObject, managedGpuString } from "@/lib/server/managed-gpu-api";
import { requireManagedGpuFeature } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireManagedGpuFeature();
    const command = await managedGpuAdminMutation(request, ["ADMIN_PANEL_READ"]);
    const actionType = managedGpuString(command.input, "actionType", 8, 40) as ManagedGpuApprovalAction;
    const permission = MANAGED_GPU_APPROVAL_PERMISSIONS[actionType];
    if (!permission) throw new AccountAuthError("MANAGED_GPU_VALIDATION_ERROR", 400, "审批动作无效。");
    await requireAdminPermission(request, [permission]);
    const commandPayload = managedGpuObject(command.input.commandPayload);
    const result = await (await getManagedGpuStore()).requestApproval(command.context, {
      actionType, targetId: managedGpuString(command.input, "targetId", 4, 160), commandPayloadHash: await accountAuthDigest(JSON.stringify(commandPayload)), commandPayload,
    });
    return jsonResponse(result, result.replayed ? 200 : 201, { "idempotency-replayed": String(result.replayed) }, context);
  } catch (error) { return apiErrorResponse(error, undefined, context); }
}
