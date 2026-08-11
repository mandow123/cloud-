import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { acceptHostingContract } from "@/lib/server/hosting-contract-service";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { hostingContractClientView, hostingMutationContext, hostingObject, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ contractId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const body = hostingObject(await readJsonBody(request));
    if (Object.keys(body).length) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "验收请求不接受客户端计量、费率或收益字段。 ");
    const { contractId } = await contextValue.params;
    const mutation = await hostingMutationContext(request, account.account.id, body);
    const result = await acceptHostingContract({ account, contractId, mutation });
    return jsonResponse({ record: hostingContractClientView(result.contract), settlement: result.settlement, replayed: result.replayed }, result.replayed ? 200 : 202, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
