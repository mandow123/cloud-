import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { managedGpuMemberRead } from "@/lib/server/managed-gpu-api";
import { requireManagedGpuFeature } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireManagedGpuFeature();
    const account = await managedGpuMemberRead(request);
    const records = await (await getManagedGpuStore()).listMemberQuotes(account.activeOrganization.id);
    return jsonResponse({ records, count: records.length }, 200, { "cache-control": "private, no-store" }, context);
  } catch (error) { return apiErrorResponse(error, undefined, context); }
}
