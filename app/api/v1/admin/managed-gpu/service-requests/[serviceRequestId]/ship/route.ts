import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { managedGpuAdminMutation } from "@/lib/server/managed-gpu-admin-api";
import { managedGpuInteger, managedGpuString } from "@/lib/server/managed-gpu-api";
import { requireManagedGpuFeature } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";

export const dynamic = "force-dynamic";
export async function POST(request: Request, routeContext: { params: Promise<{ serviceRequestId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireManagedGpuFeature();
    const command = await managedGpuAdminMutation(request,["FULFILLMENT_OPERATE"]);
    const { serviceRequestId } = await routeContext.params;
    const result = await (await getManagedGpuStore()).shipAsset(command.context,serviceRequestId,{expectedVersion:managedGpuInteger(command.input,"expectedVersion",1),evidenceDigest:managedGpuString(command.input,"evidenceDigest",64,64)});
    return jsonResponse(result,result.replayed?200:201,{"idempotency-replayed":String(result.replayed)},context);
  } catch (error) { return apiErrorResponse(error,undefined,context); }
}
