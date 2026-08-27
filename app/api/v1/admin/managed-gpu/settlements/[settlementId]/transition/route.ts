import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { MANAGED_GPU_SETTLEMENT_STATUSES, type ManagedGpuSettlementStatus } from "@/lib/managed-gpu";
import { AccountAuthError } from "@/lib/server/account-auth";
import { managedGpuAdminMutation } from "@/lib/server/managed-gpu-admin-api";
import { managedGpuString } from "@/lib/server/managed-gpu-api";
import { requireManagedGpuFeature } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";

export const dynamic = "force-dynamic";
export async function POST(request: Request, routeContext: { params: Promise<{ settlementId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireManagedGpuFeature();
    const command = await managedGpuAdminMutation(request,["SETTLEMENT_OPERATE"]);
    const expectedStatus = managedGpuString(command.input,"expectedStatus",5,32) as ManagedGpuSettlementStatus;
    const toStatus = managedGpuString(command.input,"toStatus",5,32) as "READY"|"APPROVED"|"POSTED";
    if (!(MANAGED_GPU_SETTLEMENT_STATUSES as readonly string[]).includes(expectedStatus) || !["READY","APPROVED","POSTED"].includes(toStatus)) throw new AccountAuthError("MANAGED_GPU_VALIDATION_ERROR",400,"月度结算状态无效。");
    const { settlementId } = await routeContext.params;
    const result = await (await getManagedGpuStore()).transitionSettlement(command.context,settlementId,{expectedStatus,toStatus});
    return jsonResponse(result,result.replayed?200:201,{"idempotency-replayed":String(result.replayed)},context);
  } catch (error) { return apiErrorResponse(error,undefined,context); }
}
