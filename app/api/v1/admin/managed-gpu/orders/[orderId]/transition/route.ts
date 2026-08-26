import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { MANAGED_GPU_ORDER_STATUSES, type ManagedGpuOrderStatus } from "@/lib/managed-gpu";
import { AccountAuthError } from "@/lib/server/account-auth";
import { managedGpuAdminMutation } from "@/lib/server/managed-gpu-admin-api";
import { managedGpuInteger, managedGpuString } from "@/lib/server/managed-gpu-api";
import { requireManagedGpuFeature } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";
export const dynamic = "force-dynamic";
export async function POST(request: Request, routeContext: { params: Promise<{ orderId: string }> }) { const context = beginApiRequest(request); try { requireManagedGpuFeature(); const command = await managedGpuAdminMutation(request, ["FULFILLMENT_OPERATE"]); const toStatus = managedGpuString(command.input, "toStatus", 4, 30) as ManagedGpuOrderStatus; if (!MANAGED_GPU_ORDER_STATUSES.includes(toStatus)) throw new AccountAuthError("MANAGED_GPU_VALIDATION_ERROR", 400, "订单目标状态无效。"); const { orderId } = await routeContext.params; const result = await (await getManagedGpuStore()).transitionOrder(command.context, orderId, { expectedVersion: managedGpuInteger(command.input, "expectedVersion", 1), toStatus }); return jsonResponse(result, result.replayed ? 200 : 201, { "idempotency-replayed": String(result.replayed) }, context); } catch (error) { return apiErrorResponse(error, undefined, context); } }
