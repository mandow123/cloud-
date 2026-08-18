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
    const admin = await requireAdminPermission(request, ["FULFILLMENT_OPERATE", "SETTLEMENT_OPERATE"]);
    if (!admin.principal.roles.includes("ROOT")) throw new AccountAuthError("HOSTING_DISPUTE_REQUEST_ROLE_REQUIRED", 403, "争议裁决方案必须由 Root 管理员发起。 ");
    const body = hostingObject(await readJsonBody(request));
    for (const field of ["requestedBy", "decidedBy", "status", "settledMicros", "supplierIncomeMicros", "commissionMicros", "payloadHash"]) if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    const resolution = hostingString(body, "resolution", 6, 6);
    if (resolution !== "REFUND" && resolution !== "SETTLE") throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "争议裁决方案不受支持。 ");
    const evidenceDigest = body.evidenceDigest == null || body.evidenceDigest === "" ? null : hostingString(body, "evidenceDigest", 64, 64).toLowerCase();
    if (evidenceDigest && !/^[a-f0-9]{64}$/u.test(evidenceDigest)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "争议证据仅接受 SHA-256 摘要。 ");
    const { contractId } = await contextValue.params;
    if (!/^hctr_[a-z0-9_-]{8,80}$/u.test(contractId)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "争议合同编号无效。 ");
    const mutation = await hostingMutationContext(request, admin.principal.id, body);
    const record = await (await getHostingV2Store()).requestDisputeResolution(contractId, {
      resolution,
      expectedContractVersion: hostingInteger(body, "expectedContractVersion", 1),
      requestReason: hostingString(body, "requestReason", 8, 500),
      evidenceDigest,
    }, mutation);
    return jsonResponse({ record }, 201, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
