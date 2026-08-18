import { parseCreateSwapQuote } from "@/lib/exchange";
import {
  apiErrorResponse, beginApiRequest, jsonResponse, mutationHash,
  prepareWrite, readJsonBody, requireIdempotencyKey,
} from "@/lib/server/api-guard";
import { requireExchangeRole } from "@/lib/server/exchange-auth";
import { getExchangeStore } from "@/lib/server/exchange-store";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { MarketplaceInputError } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    await requireExchangeRole(request, "supplier");
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    const view = new URL(request.url).searchParams.get("view") ?? "mine";
    const store = await getExchangeStore();
    if (view === "mine") {
      const items = await store.listSwapQuotes(actor.id);
      return jsonResponse({ view, items, count: items.length }, 200, actor.responseHeaders, context);
    }
    if (view === "options") {
      const listings = await store.listMarketListings();
      const offered = listings.filter((listing) => listing.supplierActorId === actor?.id);
      const wanted = listings.filter((listing) => listing.supplierActorId !== actor?.id);
      return jsonResponse({ view, offered, wanted }, 200, actor.responseHeaders, context);
    }
    throw new MarketplaceInputError("view must be mine or options.", "view");
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    await requireExchangeRole(request, "supplier");
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    prepareWrite(request, actor);
    await persistMarketplaceSession(authorization);
    const input = parseCreateSwapQuote(await readJsonBody(request));
    const result = await (await getExchangeStore()).createSwapQuote({
      actorId: actor.id,
      idempotencyKey: requireIdempotencyKey(request),
      payloadHash: await mutationHash(input),
    }, input);
    const headers = new Headers(actor.responseHeaders);
    headers.set("idempotency-replayed", String(result.replayed));
    return jsonResponse({ record: result.record, replayed: result.replayed }, result.replayed ? 200 : 201, headers, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
