import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { AccountAuthError } from "@/lib/server/account-auth";
import { managedGpuAdminMutation } from "@/lib/server/managed-gpu-admin-api";
import { managedGpuCurrency, managedGpuInteger, managedGpuString } from "@/lib/server/managed-gpu-api";
import { requireManagedGpuFeature } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";

export const dynamic = "force-dynamic";
const EVENT_TYPES = new Set(["CAPTURED", "REFUNDED", "CHARGEBACK", "REVERSAL"] as const);

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireManagedGpuFeature();
    const command = await managedGpuAdminMutation(request, ["PAYMENT_OPERATE"]);
    const eventType = managedGpuString(command.input, "eventType", 8, 20);
    if (!EVENT_TYPES.has(eventType as never)) throw new AccountAuthError("MANAGED_GPU_VALIDATION_ERROR", 400, "付款事件类型无效。");
    const result = await (await getManagedGpuStore()).recordPaymentEvidence(command.context, {
      orderId: managedGpuString(command.input, "orderId", 8, 100),
      provider: managedGpuString(command.input, "provider", 2, 80),
      providerReference: managedGpuString(command.input, "providerReference", 4, 160),
      eventType: eventType as "CAPTURED" | "REFUNDED" | "CHARGEBACK" | "REVERSAL",
      amountMinor: managedGpuInteger(command.input, "amountMinor", 1),
      currency: managedGpuCurrency(command.input, "currency"),
      payloadDigest: managedGpuString(command.input, "payloadDigest", 64, 64),
      occurredAt: managedGpuString(command.input, "occurredAt", 20, 40),
    });
    return jsonResponse(result, result.replayed ? 200 : 201, { "idempotency-replayed": String(result.replayed) }, context);
  } catch (error) { return apiErrorResponse(error, undefined, context); }
}
