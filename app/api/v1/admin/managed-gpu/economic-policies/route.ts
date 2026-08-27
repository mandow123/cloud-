import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { managedGpuAdminMutation } from "@/lib/server/managed-gpu-admin-api";
import { managedGpuInteger, managedGpuObject, managedGpuString } from "@/lib/server/managed-gpu-api";
import { requireManagedGpuFeature } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireManagedGpuFeature();
    const command = await managedGpuAdminMutation(request,["SETTLEMENT_OPERATE"]);
    const input = command.input;
    const effectiveUntil = input.effectiveUntil == null ? null : managedGpuString(input,"effectiveUntil",20,40);
    const result = await (await getManagedGpuStore()).publishEconomicPolicy(command.context,{
      policyCode: managedGpuString(input,"policyCode",3,80), versionNumber: managedGpuInteger(input,"versionNumber",1,1_000_000),
      facilityId: managedGpuString(input,"facilityId",4,100), facilityChargeMicrosPerAssetDay: managedGpuInteger(input,"facilityChargeMicrosPerAssetDay",0),
      calculation: managedGpuObject(input.calculation), effectiveFrom: managedGpuString(input,"effectiveFrom",20,40), effectiveUntil,
    });
    return jsonResponse(result,result.replayed?200:201,{"idempotency-replayed":String(result.replayed)},context);
  } catch (error) { return apiErrorResponse(error,undefined,context); }
}
