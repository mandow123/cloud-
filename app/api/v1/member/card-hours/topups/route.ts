import { cnyCentsToCardHourMicros, formatCardHourDisplayMicros, parseTopupCardHours, topupAmountCents } from "@/lib/card-hours";
import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, mutationHash, prepareWrite, readJsonBody, requireIdempotencyKey } from "@/lib/server/api-guard";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { isKaiIdentityConfigured, probeKaiIdentityDiscovery } from "@/lib/server/kai-identity-oidc";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import { createQixiangPayCheckout, qixiangPayPilotAccess, qixiangPayReadiness, QixiangPayError, type QixiangCheckoutOrder, type QixiangPaymentChannel, trustedQixiangClientIp, validateQixiangPayCheckout } from "@/lib/server/qixiang-pay";

export const dynamic = "force-dynamic";

function paymentType(channel: QixiangPaymentChannel) { return channel === "ALIPAY" ? "alipay" as const : "wxpay" as const; }

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const authorization = await authorizeMarketplaceRequest(request);
    prepareWrite(request, authorization.actor);
    await persistMarketplaceSession(authorization);
    const body = await readJsonBody(request) as { cardHours?: unknown; channel?: unknown };
    let cardHourMicros: number;
    try { cardHourMicros = parseTopupCardHours(body.cardHours); } catch { throw new AccountAuthError("CARD_HOUR_TOPUP_INVALID", 400, "购买数量必须是 5.00 卡时的整数倍。 "); }
    if (body.channel !== "ALIPAY" && body.channel !== "WXPAY") throw new AccountAuthError("CARD_HOUR_TOPUP_CHANNEL_INVALID", 400, "请选择已开放的充值渠道。 ");
    const channel = body.channel;
    const readiness = qixiangPayReadiness();
    const pilot = qixiangPayPilotAccess(account.activeOrganization.id);
    if (!pilot.ready || channel !== pilot.channel || cardHourMicros !== pilot.cardHours * 1_000_000) throw new AccountAuthError("CARD_HOUR_TOPUP_PILOT_RESTRICTED", 403, "当前账户仅可在获准渠道充值 5.00 卡时。 ");
    if (!readiness.canCreatePayment || !readiness.channels.includes(channel)) throw new QixiangPayError("QIXIANG_PAY_NOT_CONFIGURED", readiness.enabled ? "所选充值渠道尚未就绪。" : "人民币充值通道当前保持关闭。");
    if (!readiness.merchantAccountRef) throw new QixiangPayError("QIXIANG_PAY_NOT_CONFIGURED", "充值商户配置未完成。");
    if (account.authMethod !== "KAI_IDENTITY_OIDC") throw new AccountAuthError("KAI_IDENTITY_REAUTH_REQUIRED", 503, "请使用 KAI 统一账户重新登录后再充值。 ");
    if (!isKaiIdentityConfigured()) throw new AccountAuthError("KAI_IDENTITY_NOT_CONFIGURED", 503, "统一账户配置未完成，人民币充值保持关闭。 ");
    const identity = await probeKaiIdentityDiscovery();
    if (!identity.available) throw new AccountAuthError("KAI_IDENTITY_UNAVAILABLE", 503, "统一账户暂时不可用，人民币充值保持关闭，请稍后重试。 ");
    const clientIp = trustedQixiangClientIp(request);
    const amountCents = topupAmountCents(cardHourMicros);
    const idempotencyKey = requireIdempotencyKey(request);
    const now = new Date();
    const store = await getCardHourStore();
    const result = await store.createTopup({
      account, cardHourMicros, amountCents, provider: "QIXIANG_PAY", providerMerchantRef: readiness.merchantAccountRef,
      providerPaymentType: paymentType(channel), idempotencyKey,
      payloadHash: await mutationHash({ provider: "QIXIANG_PAY", channel, cardHourMicros, amountCents }),
      now: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
    });
    const record = result.record as { id: string };
    const providerCheckoutInput: QixiangCheckoutOrder = {
      orderId: record.id, amountCents, channel, clientIp,
      subject: `KAI Cloud 充值 ${formatCardHourDisplayMicros(cardHourMicros)} KAI 标准卡时`,
      returnPath: `/member/card-hours/topups/${encodeURIComponent(record.id)}/return`,
    };
    // Deterministic provider validation happens before the attempt is claimed.
    validateQixiangPayCheckout(providerCheckoutInput);
    const claim = await store.claimTopupCheckout({ organizationId: account.activeOrganization.id, orderId: record.id, now: new Date().toISOString() });
    const existingCheckoutUrl = typeof claim.record.checkoutUrl === "string" ? claim.record.checkoutUrl : null;
    if (!claim.claimed && !existingCheckoutUrl) {
      if (claim.record.status === "RECONCILIATION_REQUIRED") throw new AccountAuthError("CARD_HOUR_TOPUP_RECONCILIATION_REQUIRED", 409, "支付结果需要平台人工核对，请勿重复付款。 ");
      throw new AccountAuthError("CARD_HOUR_TOPUP_CHECKOUT_PROCESSING", 409, "充值收银台正在创建，请稍后重试同一请求。 ");
    }
    let checkoutUrl = existingCheckoutUrl;
    let responseRecord = claim.record;
    if (!checkoutUrl) {
      let checkout;
      try {
        checkout = await createQixiangPayCheckout(providerCheckoutInput);
      } catch (error) {
        await store.markTopupReconciliationRequired({ organizationId: account.activeOrganization.id, orderId: record.id, now: new Date().toISOString() });
        throw error;
      }
      checkoutUrl = checkout.checkoutUrl;
      try {
        await store.attachTopupCheckout({ organizationId: account.activeOrganization.id, orderId: record.id, checkoutUrl, now: new Date().toISOString() });
        const safeRecord = await store.getTopupForOrganization(account.activeOrganization.id, record.id);
        if (!safeRecord) throw new AccountAuthError("CARD_HOUR_TOPUP_NOT_FOUND", 404, "充值记录不存在。 ");
        responseRecord = safeRecord;
      } catch (error) {
        await store.markTopupReconciliationRequired({ organizationId: account.activeOrganization.id, orderId: record.id, now: new Date().toISOString() });
        throw error;
      }
    }
    return jsonResponse({
      record: responseRecord, checkoutUrl, provider: "QIXIANG_PAY", channel,
      rate: { cardHours: "1", cny: "1.002" }, referenceMicrosForOneYuan: cnyCentsToCardHourMicros(100), replayed: result.replayed,
    }, result.replayed ? 200 : 201, authorization.actor.responseHeaders, context);
  } catch (error) {
    if (error instanceof QixiangPayError) return jsonResponse({ error: { code: error.code, message: error.message, requestId: context.requestId } }, error.code === "QIXIANG_PAY_NOT_CONFIGURED" || error.code === "QIXIANG_PAY_OUTCOME_UNKNOWN" ? 503 : 400, undefined, context);
    return apiErrorResponse(error, undefined, context);
  }
}
