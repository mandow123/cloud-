import { formatCardHourMicros } from "@/lib/card-hours";
import {
  apiErrorResponse,
  beginApiRequest,
  jsonResponse,
  prepareWrite,
  requireIdempotencyKey,
} from "@/lib/server/api-guard";
import { requireExchangeRole } from "@/lib/server/exchange-auth";
import { AccountAuthError } from "@/lib/server/account-auth";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import { getSupplyStore } from "@/lib/server/supply-store";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录交易账户。 ");
    await requireExchangeRole(request, "buyer");
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    prepareWrite(request, actor);
    await persistMarketplaceSession(authorization);
    const { id } = await contextValue.params;
    // Initialize the production supply schema before the shared database transaction.
    await getSupplyStore();
    const captured = await (await getCardHourStore()).settleSupplyOrder({
      account, actorId: actor.id, orderId: id,
      idempotencyKey: requireIdempotencyKey(request), now: new Date().toISOString(),
    });
    const { amountMicros, replayed } = captured;
    const headers = new Headers(actor.responseHeaders);
    headers.set("idempotency-replayed", String(replayed));
    return jsonResponse({
      record: captured.record,
      provider: "KAI_CARD_HOUR",
      assetCode: "KAI_CREDIT_HOUR",
      amountCardHours: formatCardHourMicros(amountMicros),
      amountMicros,
      cnyReferenceCents: captured.cnyReferenceCents,
      rate: { cardHours: "1", cny: "1.002" },
      replayed,
    }, replayed ? 200 : 201, headers, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
