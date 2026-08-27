import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { managedGpuAdminMutation } from "@/lib/server/managed-gpu-admin-api";
import { managedGpuString } from "@/lib/server/managed-gpu-api";
import { requireManagedGpuFeature } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { const context = beginApiRequest(request); try { requireManagedGpuFeature(); const command = await managedGpuAdminMutation(request, ["SETTLEMENT_OPERATE"]); const input = command.input; const result = await (await getManagedGpuStore()).createSettlement(command.context, { assetId: managedGpuString(input, "assetId", 8, 100), periodStart: managedGpuString(input, "periodStart", 20, 40), periodEnd: managedGpuString(input, "periodEnd", 20, 40), policyVersionId: managedGpuString(input, "policyVersionId", 8, 100), sourceKey: managedGpuString(input, "sourceKey", 16, 200) }); return jsonResponse(result, result.replayed ? 200 : 201, { "idempotency-replayed": String(result.replayed) }, context); } catch (error) { return apiErrorResponse(error, undefined, context); } }
