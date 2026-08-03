import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { authorizeMarketplaceRequest } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { DEMO_RETENTION_DAYS } from "@/lib/server/marketplace-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    return jsonResponse({
      session: {
        source: actor.source,
        csrfToken: actor.csrfToken,
        expiresAt: actor.expiresAt,
        retentionDays: DEMO_RETENTION_DAYS,
      },
    }, 200, actor.responseHeaders, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
