import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { hostingMutationContext, hostingObject, requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { isAgentTelemetryV1Enabled } from "@/lib/server/agent-telemetry-feature";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const body = hostingObject(await readJsonBody(request));
    const keys = Object.keys(body).sort();
    const telemetry = body.capabilityMode === "TELEMETRY_ONLY";
    if (telemetry) {
      if (!isAgentTelemetryV1Enabled()) throw new AccountAuthError("HOSTING_TELEMETRY_DISABLED", 404, "设备遥测接入尚未开放。 ");
      if (keys.join(",") !== "applicationId,capabilityMode" || typeof body.applicationId !== "string") throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "遥测设备挑战必须绑定有效供应申请。 ");
    } else if (keys.length) {
      throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "完整托管设备登记挑战不接受客户端身份字段。 ");
    }
    if (!telemetry) requireHostingV2SetupEnabled();
    const mutation = await hostingMutationContext(request, account.account.id, body);
    const record = await (await getHostingV2Store()).issueAgentChallenge(account, mutation, telemetry ? { applicationId: body.applicationId as string, capabilityMode: "TELEMETRY_ONLY" } : undefined);
    return jsonResponse({ record }, 201, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
