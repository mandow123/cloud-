import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { requireAdminPermission } from "@/lib/server/admin-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { hostingInteger, hostingMutationContext, hostingObject, hostingString, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ organizationId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    assertAccountAuthSameOrigin(request);
    const admin = await requireAdminPermission(request, ["SUPPLY_INTAKE_REVIEW"]);
    const body = hostingObject(await readJsonBody(request));
    for (const field of ["actorId", "payloadHash", "status", "reviewedBy"]) {
      if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    }
    const decision = hostingString(body, "decision", 6, 7);
    if (decision !== "APPROVE" && decision !== "REJECT" && decision !== "SUSPEND") throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "审核决定不受支持。 ");
    const evidenceDigest = body.evidenceDigest == null || body.evidenceDigest === "" ? null : hostingString(body, "evidenceDigest", 64, 64).toLowerCase();
    if (evidenceDigest && !/^[a-f0-9]{64}$/u.test(evidenceDigest)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "审核证据仅接受 SHA-256 摘要。 ");
    const { organizationId } = await contextValue.params;
    if (!organizationId || organizationId.length > 200) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "供应主体标识无效。 ");
    const mutation = await hostingMutationContext(request, admin.principal.id, body);
    const record = await (await getHostingV2Store()).reviewProfile(organizationId, {
      decision,
      expectedVersion: hostingInteger(body, "expectedVersion", 1),
      reviewNote: hostingString(body, "reviewNote", 4, 500),
      evidenceDigest,
    }, mutation);
    return jsonResponse({ record }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
