import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { hostingInteger, hostingMutationContext, hostingObject, requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-api";
import { hostingV2CurrentTermsVersion } from "@/lib/server/hosting-v2-image-policy";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2SetupEnabled();
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const body = hostingObject(await readJsonBody(request));
    if (body.agreementAccepted !== true) throw new AccountAuthError("HOSTING_AGREEMENT_REQUIRED", 400, "请阅读并同意当前版本的算力供应协议。 ");
    for (const field of ["actorId", "accountId", "organizationId", "payloadHash", "status", "agreementVersion"]) {
      if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    }
    const agreementVersion = hostingV2CurrentTermsVersion();
    const mutation = await hostingMutationContext(request, account.account.id, { ...body, agreementVersion });
    const record = await (await getHostingV2Store()).submitProfile(account.activeOrganization.id, hostingInteger(body, "expectedVersion", 1), agreementVersion, mutation);
    return jsonResponse({ record }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
