import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { AccountAuthError } from "@/lib/server/account-auth";
import { managedGpuAdminMutation } from "@/lib/server/managed-gpu-admin-api";
import { managedGpuInteger, managedGpuString } from "@/lib/server/managed-gpu-api";
import { requireManagedGpuFeature } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { const context = beginApiRequest(request); try { requireManagedGpuFeature(); const command = await managedGpuAdminMutation(request, ["KAI_SELF_INVENTORY_WRITE"]); const status = managedGpuString(command.input, "status", 8, 8); if (status!=="EXPECTED") throw new AccountAuthError("MANAGED_GPU_VALIDATION_ERROR", 400, "新资产必须从待收货状态开始。"); const result = await (await getManagedGpuStore()).createAsset(command.context, { orderId: managedGpuString(command.input, "orderId", 8, 100), unitIndex: managedGpuInteger(command.input, "unitIndex", 1, 100), serialFingerprint: managedGpuString(command.input, "serialFingerprint", 64, 64), facilityId: typeof command.input.facilityId === "string" && command.input.facilityId.trim() ? command.input.facilityId.trim() : null, status: "EXPECTED" }); return jsonResponse(result, result.replayed ? 200 : 201, { "idempotency-replayed": String(result.replayed) }, context); } catch (error) { return apiErrorResponse(error, undefined, context); } }
