import { AccountAuthError } from "@/lib/server/account-auth";
import { getAdminOperationsStore } from "@/lib/server/admin-store";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";

export const dynamic = "force-dynamic";

export async function GET(request: Request, contextValue: { params: Promise<{ demandId: string }> }) {
  const context = beginApiRequest(request);
  try {
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const { demandId } = await contextValue.params;
    const record = await (await getAdminOperationsStore()).getMemberCatalogPurchaseIntent(account.activeOrganization.id, demandId);
    if (!record) throw new AccountAuthError("PURCHASE_INTENT_NOT_FOUND", 404, "算力申请不存在。 ");
    return jsonResponse({ record }, 200, { "cache-control": "private, no-store" }, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
