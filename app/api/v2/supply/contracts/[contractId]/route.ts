import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { hostingSupplierContractClientView, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, contextValue: { params: Promise<{ contractId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const { contractId } = await contextValue.params;
    const contract = await (await getHostingV2Store()).contractForViewer(account.activeOrganization.id, contractId);
    if (!contract) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "供应订单不存在。");
    if (contract.supplierOrganizationId !== account.activeOrganization.id) throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "供应订单只能由所属供应主体查看。");
    return jsonResponse({ record: hostingSupplierContractClientView(contract) }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
