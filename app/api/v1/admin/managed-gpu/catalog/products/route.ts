import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { AccountAuthError } from "@/lib/server/account-auth";
import { managedGpuAdminMutation } from "@/lib/server/managed-gpu-admin-api";
import { managedGpuCurrency, managedGpuInteger, managedGpuObject, managedGpuString } from "@/lib/server/managed-gpu-api";
import { requireManagedGpuFeature } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";

export const dynamic = "force-dynamic";

function stringList(value: unknown, field: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string" || item.trim().length < 2 || item.trim().length > 100)) throw new AccountAuthError("MANAGED_GPU_VALIDATION_ERROR",400,`${field} 无效。`);
  return value.map((item) => String(item).trim());
}

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireManagedGpuFeature();
    const command = await managedGpuAdminMutation(request, ["MARKET_PUBLISH"]);
    const input = command.input;
    const hardwareTier = managedGpuString(input, "hardwareTier", 8, 20) as "CONSUMER" | "WORKSTATION" | "DATACENTER";
    const result = await (await getManagedGpuStore()).publishProductVersion(command.context, {
      hardwareClassId: managedGpuString(input,"hardwareClassId",3,80), sku: managedGpuString(input,"sku",3,80),
      manufacturer: managedGpuString(input,"manufacturer",2,120), model: managedGpuString(input,"model",2,120),
      displayName: managedGpuString(input,"displayName",2,120), sellerName: managedGpuString(input,"sellerName",2,120),
      gpuModel: managedGpuString(input,"gpuModel",2,120), hardwareTier, vramGb: managedGpuInteger(input,"vramGb",1,10_000),
      specs: managedGpuObject(input.specs), verifiedInventoryCount: managedGpuInteger(input,"verifiedInventoryCount",1,100_000),
      inventoryEvidenceDigest: managedGpuString(input,"inventoryEvidenceDigest",64,64), currency: managedGpuCurrency(input,"currency"),
      warrantyMonths: managedGpuInteger(input,"warrantyMonths",0,1200), estimatedDeliveryDays: managedGpuInteger(input,"estimatedDeliveryDays",0,1200),
      fulfillmentModes: stringList(input.fulfillmentModes,"fulfillmentModes",2) as Array<"BEIDOU_HOSTING" | "GLOBAL_SHIPPING">,
      facilityIds: stringList(input.facilityIds,"facilityIds",100), quoteValidUntil: managedGpuString(input,"quoteValidUntil",20,40),
    });
    return jsonResponse(result,result.replayed?200:201,{"idempotency-replayed":String(result.replayed)},context);
  } catch (error) { return apiErrorResponse(error,undefined,context); }
}
