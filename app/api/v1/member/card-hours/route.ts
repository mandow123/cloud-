import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { AccountAuthError } from "@/lib/server/account-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    return jsonResponse(await (await getCardHourStore()).dashboard(account.activeOrganization.id, new Date().toISOString()), 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
