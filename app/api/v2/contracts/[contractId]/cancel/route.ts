import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { cancelHostingContract } from "@/lib/server/hosting-contract-service";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { hostingContractClientView, hostingMutationContext, hostingObject, hostingString, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ contractId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const body = hostingObject(await readJsonBody(request));
    for (const field of ["actorId", "accountId", "organizationId", "payloadHash", "status", "id"]) {
      if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    }
    const { contractId } = await contextValue.params;
    const mutation = await hostingMutationContext(request, account.account.id, body);
    const result = await cancelHostingContract({ account, contractId, reason: hostingString(body, "reason", 4, 500), mutation });
    return jsonResponse({ record: hostingContractClientView(result.contract), billing: result.hold ? { status: String(result.hold.status), heldMicros: Number(result.hold.amountMicros) } : null }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
