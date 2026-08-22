import { assertAccountAuthSameOrigin, AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, mutationHash, readJsonBody, requireIdempotencyKey } from "@/lib/server/api-guard";
import { getCardHourStore, type CardHourTopupAppealReason } from "@/lib/server/card-hour-store";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";

export const dynamic = "force-dynamic";

function validOrderId(value: string) {
  if (!/^KAI_CH_[A-Za-z0-9]{16,56}$/u.test(value)) throw new AccountAuthError("CARD_HOUR_TOPUP_NOT_FOUND", 404, "充值记录不存在。 ");
  return value;
}

export async function GET(request: Request, contextValue: { params: Promise<{ orderId: string }> }) {
  const context = beginApiRequest(request);
  try {
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const { orderId: rawOrderId } = await contextValue.params;
    const orderId = validOrderId(rawOrderId);
    const store = await getCardHourStore();
    const topup = await store.getTopupForOrganization(account.activeOrganization.id, orderId);
    if (!topup) throw new AccountAuthError("CARD_HOUR_TOPUP_NOT_FOUND", 404, "充值记录不存在。 ");
    const record = await store.getTopupAppealForOrganization(account.activeOrganization.id, orderId);
    return jsonResponse({ topup, record }, 200, { "cache-control": "private, no-store" }, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}

export async function POST(request: Request, contextValue: { params: Promise<{ orderId: string }> }) {
  const context = beginApiRequest(request);
  try {
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const { orderId: rawOrderId } = await contextValue.params;
    const orderId = validOrderId(rawOrderId);
    const input = await readJsonBody(request) as { reason?: unknown; description?: unknown };
    if (!(["PENDING_TIMEOUT", "CLOSED_BUT_CHARGED", "RECONCILIATION_REQUIRED"] as const).includes(input.reason as CardHourTopupAppealReason)) throw new AccountAuthError("CARD_HOUR_TOPUP_APPEAL_INVALID", 400, "充值申诉原因无效。 ");
    if (typeof input.description !== "string") throw new AccountAuthError("CARD_HOUR_TOPUP_APPEAL_INVALID", 400, "请填写充值问题说明。 ");
    const result = await (await getCardHourStore()).createTopupAppeal({
      account,
      orderId,
      reason: input.reason as CardHourTopupAppealReason,
      description: input.description,
      idempotencyKey: requireIdempotencyKey(request),
      payloadHash: await mutationHash({ orderId, reason: input.reason, description: input.description.trim() }),
      now: new Date().toISOString(),
    });
    return jsonResponse(result, result.replayed ? 200 : 201, { "cache-control": "private, no-store", "idempotency-replayed": String(result.replayed) }, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
