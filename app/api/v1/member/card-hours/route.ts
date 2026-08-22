import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { AccountAuthError } from "@/lib/server/account-auth";
import { qixiangPayPilotAccess } from "@/lib/server/qixiang-pay";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const dashboard = await (await getCardHourStore()).dashboard(account.activeOrganization.id, new Date().toISOString());
    const pilot = qixiangPayPilotAccess(account.activeOrganization.id);
    const channels = (["ALIPAY", "WXPAY"] as const).map((channel) => ({
      channel,
      ready: pilot.ready && pilot.channel === channel,
      reason: pilot.ready && pilot.channel === channel ? null : "该充值渠道尚未开放。",
    }));
    return jsonResponse({
      ...dashboard,
      topupAvailability: {
        ready: pilot.ready,
        mode: pilot.ready ? "PILOT" : "CATALOG",
        reason: pilot.reason,
        minCardHours: pilot.ready ? 5 : 5,
        maxCardHours: pilot.ready ? 5 : null,
        stepCardHours: 5,
        channels,
        packages: pilot.ready
          ? [{ code: "PRODUCTION_ACCEPTANCE", name: "生产验收充值", cardHours: 5, amountCents: 501, description: "当前仅支持小额生产验收" }]
          : [
            { code: "STARTER", name: "入门套餐", cardHours: 100, amountCents: 10_020, description: "适合短时测试与体验" },
            { code: "STANDARD", name: "标准套餐", cardHours: 500, amountCents: 50_100, description: "适合日常开发与多次任务", badge: "常用" },
            { code: "TEAM", name: "团队套餐", cardHours: 1_000, amountCents: 100_200, description: "适合团队共享组织账户使用" },
          ],
      },
    }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
