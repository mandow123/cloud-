import { parseTopupCardHours } from "@/lib/card-hours";
import { apiErrorResponse, beginApiRequest, jsonResponse, prepareWrite, readJsonBody, requireIdempotencyKey } from "@/lib/server/api-guard";
import { createCardHourTopupOrder } from "@/lib/server/card-hour-topup-service";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import { AccountAuthError } from "@/lib/server/account-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const authorization = await authorizeMarketplaceRequest(request);
    prepareWrite(request, authorization.actor);
    await persistMarketplaceSession(authorization);
    const body = await readJsonBody(request) as { cardHours?: unknown };
    let cardHourMicros: number;
    try { cardHourMicros = parseTopupCardHours(body.cardHours); } catch { throw new AccountAuthError("CARD_HOUR_TOPUP_INVALID", 400, "购买数量必须是 5.00 卡时的整数倍。 "); }
    const idempotencyKey = requireIdempotencyKey(request);
    const result = await createCardHourTopupOrder({ account, cardHourMicros, idempotencyKey, now: new Date() });
    return jsonResponse(result, result.replayed ? 200 : 201, authorization.actor.responseHeaders, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
