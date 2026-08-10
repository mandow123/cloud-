import { apiErrorResponse, beginApiRequest, jsonResponse, prepareWrite, readJsonBody } from "@/lib/server/api-guard";
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
    const body = await readJsonBody(request) as { code?: unknown };
    if (typeof body.code !== "string") throw new AccountAuthError("REFERRAL_CODE_INVALID", 400, "邀请码格式无效。 ");
    await (await getCardHourStore()).attachReferral({ account, code: body.code, now: new Date().toISOString() });
    return jsonResponse({ record: { attached: true }, replayed: false }, 201, authorization.actor.responseHeaders, context);
  } catch (error) { return apiErrorResponse(error, undefined, context); }
}
