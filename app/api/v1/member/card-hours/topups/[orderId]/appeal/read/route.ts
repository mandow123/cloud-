import { assertAccountAuthSameOrigin, AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ orderId: string }> }) {
  const context = beginApiRequest(request);
  try {
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const { orderId } = await contextValue.params;
    if (!/^KAI_CH_[A-Za-z0-9]{16,56}$/u.test(orderId)) throw new AccountAuthError("CARD_HOUR_TOPUP_NOT_FOUND", 404, "充值记录不存在。 ");
    const record = await (await getCardHourStore()).acknowledgeTopupAppeal({
      organizationId: account.activeOrganization.id,
      orderId,
      now: new Date().toISOString(),
    });
    return jsonResponse({ record, replayed: true }, 200, { "cache-control": "private, no-store" }, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
