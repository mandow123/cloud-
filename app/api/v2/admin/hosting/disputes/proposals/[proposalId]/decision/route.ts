import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { requireAdminPermission } from "@/lib/server/admin-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { decideAndExecuteHostingDispute } from "@/lib/server/hosting-dispute-service";
import { hostingMutationContext, hostingObject, hostingString, requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ proposalId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2SetupEnabled();
    assertAccountAuthSameOrigin(request);
    const admin = await requireAdminPermission(request, ["SETTLEMENT_OPERATE"]);
    if (!admin.principal.roles.includes("FINANCE_APPROVER")) throw new AccountAuthError("HOSTING_DISPUTE_APPROVER_ROLE_REQUIRED", 403, "争议裁决必须由独立财务审批管理员完成。 ");
    const body = hostingObject(await readJsonBody(request));
    for (const field of ["requestedBy", "decidedBy", "status", "resolution", "settledMicros", "supplierIncomeMicros", "commissionMicros", "payloadHash"]) if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    const decision = hostingString(body, "decision", 6, 7);
    if (decision !== "APPROVE" && decision !== "REJECT") throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "争议复核决定不受支持。 ");
    const { proposalId } = await contextValue.params;
    if (!/^hdsp_[a-z0-9_-]{8,80}$/u.test(proposalId)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "争议裁决申请编号无效。 ");
    const mutation = await hostingMutationContext(request, admin.principal.id, body);
    const result = await decideAndExecuteHostingDispute({
      proposalId,
      decision,
      decisionReason: hostingString(body, "decisionReason", 8, 500),
      mutation,
    });
    return jsonResponse(result, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
