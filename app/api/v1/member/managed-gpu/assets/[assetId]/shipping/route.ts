import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { managedGpuCountry, managedGpuMemberMutation, managedGpuReadBody, managedGpuRejectFields, managedGpuString } from "@/lib/server/managed-gpu-api";
import { requireManagedGpuFeature } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";
export const dynamic = "force-dynamic";
export async function POST(request: Request, routeContext: { params: Promise<{ assetId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireManagedGpuFeature(); const body = await managedGpuReadBody(request);
    managedGpuRejectFields(body, ["address", "status", "organizationId", "accountId", "assetId", "version"]);
    const { context: mutation } = await managedGpuMemberMutation(request, body); const { assetId } = await routeContext.params;
    const result = await (await getManagedGpuStore()).createServiceRequest(mutation, { assetId, requestType: "GLOBAL_SHIPPING", destinationCountryCode: managedGpuCountry(body.destinationCountryCode, "destinationCountryCode"), addressReference: managedGpuString(body, "addressReference", 16, 200), reason: managedGpuString(body, "reason", 4, 500) });
    return jsonResponse(result, result.replayed ? 200 : 201, { "idempotency-replayed": String(result.replayed) }, context);
  } catch (error) { return apiErrorResponse(error, undefined, context); }
}
