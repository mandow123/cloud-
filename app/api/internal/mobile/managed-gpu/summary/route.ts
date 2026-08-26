import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { managedGpuOrganizationEnabled } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";
import { requireMobileInternalPrincipal } from "@/lib/server/mobile-internal-auth";
import { managedGpuMemberSummaryRecord } from "@/lib/managed-gpu";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    const principal = await requireMobileInternalPrincipal(request);
    if (!managedGpuOrganizationEnabled(principal.organizationId)) return jsonResponse(managedGpuMemberSummaryRecord({ enabled:false, organizationId:principal.organizationId, summary:{orderCount:0,assetCount:0,activeAssetCount:0,settlementCount:0,confirmedIncomeCardHourMicros:0,provisionalIncomeCardHourMicros:0},orders:[],assets:[],settlements:[] }),200,{"cache-control":"private, no-store"},context);
    const store = await getManagedGpuStore();
    const [summary, orders, assets, settlements] = await Promise.all([store.memberSummary(principal.organizationId), store.listMemberOrders(principal.organizationId), store.listMemberAssets(principal.organizationId), store.listMemberSettlements(principal.organizationId)]);
    return jsonResponse(managedGpuMemberSummaryRecord({ organizationId: principal.organizationId, summary, orders, assets, settlements }), 200, { "cache-control": "private, no-store" }, context);
  } catch (error) { return apiErrorResponse(error, undefined, context); }
}
