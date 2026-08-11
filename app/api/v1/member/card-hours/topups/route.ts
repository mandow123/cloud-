import { cnyCentsToCardHourMicros, parseTopupCardHours, topupAmountCents } from "@/lib/card-hours";
import { alipayReadiness, createAlipayCheckoutUrl, AlipayLiveError } from "@/lib/server/alipay-live";
import { apiErrorResponse, beginApiRequest, jsonResponse, mutationHash, prepareWrite, readJsonBody, requireIdempotencyKey } from "@/lib/server/api-guard";
import { getCardHourStore } from "@/lib/server/card-hour-store";
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
    try { cardHourMicros = parseTopupCardHours(body.cardHours); } catch { throw new AccountAuthError("CARD_HOUR_TOPUP_INVALID", 400, "购买数量必须是 5 卡时的整数倍。 "); }
    const readiness = alipayReadiness();
    if (!readiness.canCreatePayment) throw new AlipayLiveError("ALIPAY_NOT_CONFIGURED", readiness.enabled ? `人民币购买通道尚未配置：${readiness.missing.join(", ")}` : "人民币购买通道当前按试运营边界保持关闭。");
    const amountCents = topupAmountCents(cardHourMicros);
    const idempotencyKey = requireIdempotencyKey(request);
    const now = new Date();
    const store = await getCardHourStore();
    const result = await store.createTopup({ account, cardHourMicros, amountCents, idempotencyKey, payloadHash: await mutationHash({ cardHourMicros, amountCents }), now: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString() });
    const record = result.record as { id: string };
    const checkout = createAlipayCheckoutUrl({ orderId: record.id, amountCents, subject: `KAI Cloud 购买 ${cardHourMicros / 1_000_000} 卡时`, expiresMinutes: 15, returnPath: "/member?topup=return#card-hours" });
    return jsonResponse({ record: result.record, checkoutUrl: checkout.checkoutUrl, rate: { cardHours: "1", cny: "1.002" }, referenceMicrosForOneYuan: cnyCentsToCardHourMicros(100), replayed: result.replayed }, result.replayed ? 200 : 201, authorization.actor.responseHeaders, context);
  } catch (error) {
    if (error instanceof AlipayLiveError) return jsonResponse({ error: { code: error.code, message: error.message, requestId: context.requestId } }, error.code === "ALIPAY_NOT_CONFIGURED" ? 503 : 400, undefined, context);
    return apiErrorResponse(error, undefined, context);
  }
}
