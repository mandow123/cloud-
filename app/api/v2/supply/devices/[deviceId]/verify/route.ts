import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { hostingMutationContext, hostingObject, requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ deviceId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2SetupEnabled();
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const body = hostingObject(await readJsonBody(request));
    if (Object.keys(body).length) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "验真任务不接受客户端身份或测试脚本。 ");
    const { deviceId } = await contextValue.params;
    const mutation = await hostingMutationContext(request, account.account.id, body);
    const record = await (await getHostingV2Store()).queueVerification(account.activeOrganization.id, deviceId, mutation);
    return jsonResponse({ record }, 201, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
