import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { hostingContractClientView, hostingMutationContext, hostingObject, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { requireHostingV2TransactionCapability } from "@/lib/server/hosting-v2-transaction-gate";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ contractId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    await requireHostingV2TransactionCapability();
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const body = hostingObject(await readJsonBody(request));
    if (Object.keys(body).length) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "启动命令不接受客户端脚本或状态字段。 ");
    const { contractId } = await contextValue.params;
    const mutation = await hostingMutationContext(request, account.account.id, body);
    const result = await (await getHostingV2Store()).requestContractStart(account.activeOrganization.id, contractId, mutation);
    return jsonResponse({ record: hostingContractClientView(result.contract), operation: { commandId: result.command.id, type: result.command.type, status: result.command.status } }, 202, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
