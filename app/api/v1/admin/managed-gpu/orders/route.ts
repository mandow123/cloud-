import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireAdminPermission } from "@/lib/server/admin-auth";
import { requireManagedGpuFeature } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { const context = beginApiRequest(request); try { requireManagedGpuFeature(); await requireAdminPermission(request, ["FULFILLMENT_READ"]); const records = await (await getManagedGpuStore()).listAdminOrders(); return jsonResponse({ records, count: records.length }, 200, undefined, context); } catch (error) { return apiErrorResponse(error, undefined, context); } }
