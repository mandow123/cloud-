import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { AccountAuthError } from "@/lib/server/account-auth";
import { qixiangPayReadiness } from "@/lib/server/qixiang-pay";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const [dashboard, payment] = await Promise.all([
      (await getCardHourStore()).dashboard(account.activeOrganization.id, new Date().toISOString()),
      Promise.resolve(qixiangPayReadiness()),
    ]);
    const channels = (["ALIPAY", "WXPAY"] as const).map((channel) => ({
      channel,
      ready: payment.canCreatePayment && payment.channels.includes(channel),
      reason: payment.canCreatePayment && payment.channels.includes(channel) ? null : "该充值渠道尚未开放。",
    }));
    return jsonResponse({
      ...dashboard,
      topupAvailability: payment.canCreatePayment
        ? { ready: true, reason: null, channels }
        : { ready: false, reason: "公开人民币充值尚未开放；试运营卡时只由平台双人审批发放。", channels },
    }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
