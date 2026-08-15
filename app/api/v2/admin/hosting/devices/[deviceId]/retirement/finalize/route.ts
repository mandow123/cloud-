import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { requireAdminPermission } from "@/lib/server/admin-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { hostingInteger, hostingMutationContext, hostingObject, hostingString, requireHostingV2DeviceRetirementEnabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ deviceId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2DeviceRetirementEnabled();
    assertAccountAuthSameOrigin(request);
    const admin = await requireAdminPermission(request, ["FULFILLMENT_OPERATE", "AUDIT_READ"]);
    if (!admin.principal.roles.includes("ROOT")) throw new AccountAuthError("HOSTING_DEVICE_RETIREMENT_ROOT_REQUIRED", 403, "设备退场完成确认必须由 Root 管理员执行。 ");
    const body = hostingObject(await readJsonBody(request));
    for (const field of ["actorId", "accountId", "organizationId", "mode", "status", "finalizedBy", "finalizedAt", "version", "id", "payloadHash"]) {
      if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    }
    const evidenceDigest = hostingString(body, "evidenceDigest", 64, 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(evidenceDigest)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "退场完成证据仅接受 64 位 SHA-256 摘要。 ");
    const { deviceId } = await contextValue.params;
    if (!/^had_[a-z0-9_-]{8,80}$/u.test(deviceId)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "设备编号无效。 ");
    const mutation = await hostingMutationContext(request, admin.principal.id, body);
    const result = await (await getHostingV2Store()).finalizeDeviceRetirement(deviceId, {
      expectedDeviceVersion: hostingInteger(body, "expectedDeviceVersion", 1),
      expectedRetirementVersion: hostingInteger(body, "expectedRetirementVersion", 1),
      evidenceDigest,
      finalizationReason: hostingString(body, "finalizationReason", 8, 500),
    }, mutation);
    return jsonResponse({ record: result.retirement, device: result.device }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
