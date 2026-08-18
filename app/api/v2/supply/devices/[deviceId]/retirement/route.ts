import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { hostingInteger, hostingMutationContext, hostingObject, hostingString, requireHostingV2DeviceRetirementEnabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

function validDeviceId(deviceId: string) {
  if (!/^had_[a-z0-9_-]{8,80}$/u.test(deviceId)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "设备编号无效。 ");
}

export async function GET(request: Request, contextValue: { params: Promise<{ deviceId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2DeviceRetirementEnabled();
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const { deviceId } = await contextValue.params;
    validDeviceId(deviceId);
    const record = await (await getHostingV2Store()).getDeviceRetirement(account.activeOrganization.id, deviceId);
    return jsonResponse({ record }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}

export async function POST(request: Request, contextValue: { params: Promise<{ deviceId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2DeviceRetirementEnabled();
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const body = hostingObject(await readJsonBody(request));
    for (const field of ["actorId", "accountId", "organizationId", "mode", "status", "requestedBy", "requestedAt", "finalizedBy", "finalizedAt", "version", "id", "payloadHash"]) {
      if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    }
    const reasonCode = hostingString(body, "reasonCode", 16, 17);
    if (!new Set(["SUPPLIER_REQUEST", "HARDWARE_FAILURE", "OWNERSHIP_CHANGE"]).has(reasonCode)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "供应方退场原因代码无效。 ");
    const evidenceDigest = body.evidenceDigest == null || body.evidenceDigest === "" ? null : hostingString(body, "evidenceDigest", 64, 64).toLowerCase();
    if (evidenceDigest && !/^[a-f0-9]{64}$/u.test(evidenceDigest)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "退场证据仅接受 64 位 SHA-256 摘要。 ");
    const { deviceId } = await contextValue.params;
    validDeviceId(deviceId);
    const mutation = await hostingMutationContext(request, account.account.id, body);
    const result = await (await getHostingV2Store()).requestDeviceRetirement(account.activeOrganization.id, deviceId, {
      mode: "GRACEFUL",
      expectedDeviceVersion: hostingInteger(body, "expectedDeviceVersion", 1),
      reasonCode,
      reason: hostingString(body, "reason", 8, 500),
      evidenceDigest,
    }, mutation);
    return jsonResponse({ record: result.retirement, device: result.device }, 202, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
