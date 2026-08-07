import { parseCreateCheckout } from "@/lib/exchange";
import {
  apiErrorResponse,
  beginApiRequest,
  jsonResponse,
  mutationHash,
  prepareWrite,
  readJsonBody,
  requireIdempotencyKey,
} from "@/lib/server/api-guard";
import { requireExchangeRole } from "@/lib/server/exchange-auth";
import { getExchangeStore } from "@/lib/server/exchange-store";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { bindNewEntityToOrganization, requireTradingAccountSession } from "@/lib/server/entity-ownership";

export const dynamic = "force-dynamic";

function referralCookie(request: Request) {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [name, ...value] = part.trim().split("=");
    if (name !== "kai_ref") continue;
    const raw = value.join("=");
    try { return decodeURIComponent(raw); } catch { return raw; }
  }
  return null;
}

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    const account = await requireTradingAccountSession(request);
    requireExchangeRole(request, "buyer");
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    prepareWrite(request, actor);
    await persistMarketplaceSession(authorization);
    const input = parseCreateCheckout(await readJsonBody(request));
    const store = await getExchangeStore();
    const referral = await store.resolveReferralCode(referralCookie(request));
    const idempotencyKey = requireIdempotencyKey(request);
    const result = await store.createCheckout({
      actorId: actor.id,
      idempotencyKey,
      payloadHash: await mutationHash({ input, referral }),
    }, input, referral);
    if (account) {
      await bindNewEntityToOrganization({ account, sourceSystem: "EXCHANGE", entityType: "ORDER", entityId: result.record.id, businessIdempotencyKey: idempotencyKey });
    }
    const headers = new Headers(actor.responseHeaders);
    headers.set("idempotency-replayed", String(result.replayed));
    return jsonResponse({ record: result.record, replayed: result.replayed }, result.replayed ? 200 : 201, headers, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
