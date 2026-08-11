import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { hostingContractClientView, hostingMutationContext, hostingObject, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ contractId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const body = hostingObject(await readJsonBody(request));
    if (Object.keys(body).length) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "停止命令不接受客户端计量结果。 ");
    const { contractId } = await contextValue.params;
    const store = await getHostingV2Store();
    const current = await store.contractForViewer(account.activeOrganization.id, contractId);
    if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "租赁合同不存在。");
    if (current.buyerOrganizationId !== account.activeOrganization.id) throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "只有采购方可以从该入口停止实例。");
    const mutation = await hostingMutationContext(request, account.account.id, body);
    const result = await store.requestContractStop(account.activeOrganization.id, contractId, mutation);
    return jsonResponse({ record: hostingContractClientView(result.contract), operation: { commandId: result.command.id, type: result.command.type, status: result.command.status } }, 202, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
