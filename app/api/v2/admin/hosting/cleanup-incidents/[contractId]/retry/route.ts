import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { requireAdminPermission } from "@/lib/server/admin-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { hostingInteger, hostingMutationContext, hostingObject, hostingString, requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ contractId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2SetupEnabled();
    assertAccountAuthSameOrigin(request);
    const admin = await requireAdminPermission(request, ["FULFILLMENT_OPERATE"]);
    const body = hostingObject(await readJsonBody(request));
    for (const field of ["actorId", "deviceId", "status", "commandId", "payloadHash"]) {
      if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    }
    const { contractId } = await contextValue.params;
    if (!/^hctr_[a-z0-9_-]{8,80}$/u.test(contractId)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "清理合同编号无效。 ");
    const mutation = await hostingMutationContext(request, admin.principal.id, body);
    const result = await (await getHostingV2Store()).retryCleanup(contractId, {
      expectedContractVersion: hostingInteger(body, "expectedContractVersion", 1),
      expectedDeviceVersion: hostingInteger(body, "expectedDeviceVersion", 1),
      reason: hostingString(body, "reason", 8, 500),
    }, mutation);
    return jsonResponse({ record: result.command, contract: result.contract, device: result.device }, 202, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
