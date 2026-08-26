import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { managedGpuFeatureEnabled } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";
import { managedGpuPublicCatalogRecord, managedGpuPublicFacilityRecord } from "@/lib/managed-gpu";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    const enabled = managedGpuFeatureEnabled();
    if (!enabled) return jsonResponse({ records: [], facilities: [], enabled: false, available: false, updatedAt: new Date().toISOString() }, 200, undefined, context);
    const { records, facilities } = await (await getManagedGpuStore()).listCatalog();
    const projected = records.map(managedGpuPublicCatalogRecord);
    const facilityProjection = facilities.map(managedGpuPublicFacilityRecord);
    const available = projected.some((item) => item.status === "AVAILABLE");
    return jsonResponse({ records: projected, facilities: facilityProjection, enabled, available, updatedAt: new Date().toISOString() }, 200, undefined, context);
  } catch (error) { return apiErrorResponse(error, undefined, context); }
}
