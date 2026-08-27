import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, mutationHash, prepareWrite, requireIdempotencyKey } from "@/lib/server/api-guard";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import { qixiangPayReconciliationReadiness, queryQixiangPayOrder, QixiangPayError } from "@/lib/server/qixiang-pay";
import { createDurableQixiangQueryProtection } from "@/lib/server/qixiang-query-protection";

export const dynamic = "force-dynamic";

export async function GET(request: Request, contextValue: { params: Promise<{ orderId: string }> }) {
  const context = beginApiRequest(request);
  try {
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const { orderId } = await contextValue.params;
    if (!/^KAI_CH_[A-Za-z0-9]{16,56}$/u.test(orderId)) throw new AccountAuthError("CARD_HOUR_TOPUP_NOT_FOUND", 404, "充值记录不存在。 ");
    const record = await (await getCardHourStore()).getTopupForOrganization(account.activeOrganization.id, orderId);
    if (!record) throw new AccountAuthError("CARD_HOUR_TOPUP_NOT_FOUND", 404, "充值记录不存在。 ");
    return jsonResponse({ record }, 200, { "cache-control": "private, no-store" }, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}

export async function POST(request: Request, contextValue: { params: Promise<{ orderId: string }> }) {
  const context = beginApiRequest(request);
  try {
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const authorization = await authorizeMarketplaceRequest(request);
    prepareWrite(request, authorization.actor);
    await persistMarketplaceSession(authorization);
    if (!qixiangPayReconciliationReadiness().canReconcilePayment) {
      throw new AccountAuthError("CARD_HOUR_TOPUP_RECONCILIATION_DISABLED", 503, "支付核对当前保持关闭，请通过充值申诉联系平台人工处理。 ");
    }
    const { orderId } = await contextValue.params;
    if (!/^KAI_CH_[A-Za-z0-9]{16,56}$/u.test(orderId)) throw new AccountAuthError("CARD_HOUR_TOPUP_NOT_FOUND", 404, "充值记录不存在。 ");
    const store = await getCardHourStore();
    const visible = await store.getTopupForOrganization(account.activeOrganization.id, orderId) as { status?: string } | null;
    if (!visible) throw new AccountAuthError("CARD_HOUR_TOPUP_NOT_FOUND", 404, "充值记录不存在。 ");
    const reconciliationRequest = await store.registerTopupReconciliationRequest({
      organizationId: account.activeOrganization.id,
      orderId,
      idempotencyKey: requireIdempotencyKey(request),
      payloadHash: await mutationHash({ action: "RECONCILE_QIXIANG_TOPUP", orderId }),
      now: new Date().toISOString(),
    });
    if (reconciliationRequest.replayed || !['PENDING', 'PROCESSING', 'RECONCILIATION_REQUIRED'].includes(visible.status ?? "")) return jsonResponse({ record: visible, reconciled: visible.status === "CAPTURED", replayed: reconciliationRequest.replayed }, 200, authorization.actor.responseHeaders, context);
    const now = new Date();
    const claim = await store.claimTopupReconciliation({
      organizationId: account.activeOrganization.id,
      orderId,
      now: now.toISOString(),
      staleBefore: new Date(now.getTime() - 120_000).toISOString(),
      nextEligibleAt: new Date(now.getTime() + 30_000).toISOString(),
    });
    if (!claim.claimed || !claim.claimToken) {
      const record = await store.getTopupForOrganization(account.activeOrganization.id, orderId);
      if (!record) throw new AccountAuthError("CARD_HOUR_TOPUP_NOT_FOUND", 404, "充值记录不存在。 ");
      const headers = new Headers(authorization.actor.responseHeaders);
      headers.set("retry-after", "10");
      return jsonResponse({ record, reconciled: record.status === "CAPTURED", replayed: false }, record.status === "CAPTURED" ? 200 : 202, headers, context);
    }
    try {
      const topup = await store.getTopup(orderId) as { id?: string; organizationId?: string; cardHourMicros?: number; amountCents?: number; provider?: string; providerPaymentType?: "alipay" | "wxpay" } | null;
      if (!topup || topup.organizationId !== account.activeOrganization.id || topup.provider !== "QIXIANG_PAY" || !topup.id || !topup.cardHourMicros || !topup.amountCents || (topup.providerPaymentType !== "alipay" && topup.providerPaymentType !== "wxpay")) {
        throw new AccountAuthError("CARD_HOUR_TOPUP_RECONCILIATION_INVALID", 409, "付款单不能自动核对，请联系平台处理。 ");
      }
      const event = await queryQixiangPayOrder({
        orderId: topup.id,
        amountCents: topup.amountCents,
        subject: `KAI Cloud 充值 ${formatCardHourDisplayMicros(topup.cardHourMicros)} KAI 标准卡时`,
        paymentType: topup.providerPaymentType,
        merchantParam: topup.id,
      }, undefined, fetch, createDurableQixiangQueryProtection(store));
      await store.applyTopupEvent({
        orderId: event.providerOrderId, provider: "QIXIANG_PAY", providerEventId: event.providerEventId,
        providerTransactionId: event.providerTransactionId, eventType: event.eventType, amountCents: event.amountCents,
        payloadDigest: event.rawPayloadDigest, occurredAt: event.occurredAt, receivedAt: event.verifiedAt,
      });
      const record = await store.getTopupForOrganization(account.activeOrganization.id, orderId);
      if (!record) throw new AccountAuthError("CARD_HOUR_TOPUP_NOT_FOUND", 404, "充值记录不存在。 ");
      return jsonResponse({ record, reconciled: record.status === "CAPTURED", replayed: false }, 200, authorization.actor.responseHeaders, context);
    } catch (error) {
      if (error instanceof QixiangPayError && error.code === "QIXIANG_PAY_OUTCOME_UNKNOWN") {
        const record = await store.getTopupForOrganization(account.activeOrganization.id, orderId);
        if (record) {
          const headers = new Headers(authorization.actor.responseHeaders);
          headers.set("retry-after", "30");
          return jsonResponse({ record, reconciled: false, replayed: false }, 202, headers, context);
        }
      }
      throw error;
    } finally {
      const completedAt = new Date();
      await store.releaseTopupReconciliation({ organizationId: account.activeOrganization.id, orderId, claimToken: claim.claimToken, now: completedAt.toISOString(), nextEligibleAt: new Date(completedAt.getTime() + 30_000).toISOString() });
    }
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
