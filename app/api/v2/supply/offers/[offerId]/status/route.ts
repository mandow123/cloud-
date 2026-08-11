import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { hostingInteger, hostingMutationContext, hostingObject, hostingString, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ offerId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const body = hostingObject(await readJsonBody(request));
    for (const field of ["actorId", "accountId", "organizationId", "payloadHash", "version", "id"]) {
      if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    }
    const status = hostingString(body, "status", 6, 9);
    if (status !== "PUBLISHED" && status !== "PAUSED" && status !== "UNLISTED") throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "挂牌状态操作不受支持。 ");
    const { offerId } = await contextValue.params;
    const mutation = await hostingMutationContext(request, account.account.id, body);
    const record = await (await getHostingV2Store()).updateOfferStatus(account.activeOrganization.id, offerId, { status, expectedVersion: hostingInteger(body, "expectedVersion", 1) }, mutation);
    return jsonResponse({ record }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
