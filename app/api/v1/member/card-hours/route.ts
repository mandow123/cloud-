import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { AccountAuthError } from "@/lib/server/account-auth";
import { alipayReadiness } from "@/lib/server/alipay-live";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const [dashboard, payment] = await Promise.all([
      (await getCardHourStore()).dashboard(account.activeOrganization.id, new Date().toISOString()),
      Promise.resolve(alipayReadiness()),
    ]);
    return jsonResponse({
      ...dashboard,
      topupAvailability: payment.canCreatePayment
        ? { ready: true, reason: null }
        : { ready: false, reason: "公开人民币购买尚未开放；试运营卡时只由平台双人审批发放。" },
    }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
