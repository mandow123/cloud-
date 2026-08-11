import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { HOSTING_GPU_MODELS, type HostingGpuModel } from "@/lib/hosting-v2";
import { hostingInteger, hostingMutationContext, hostingObject, hostingString, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const dashboard = await (await getHostingV2Store()).dashboard(account.activeOrganization.id, new Date().toISOString());
    return jsonResponse({ records: dashboard.offers }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const body = hostingObject(await readJsonBody(request));
    for (const field of ["actorId", "accountId", "organizationId", "feeScheduleId", "payloadHash", "status", "version", "id"]) {
      if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    }
    const gpuModel = hostingString(body, "gpuModel", 8, 16) as HostingGpuModel;
    if (!HOSTING_GPU_MODELS.includes(gpuModel)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "gpuModel 不受支持。 ");
    const mutation = await hostingMutationContext(request, account.account.id, body);
    const record = await (await getHostingV2Store()).createOffer(account.activeOrganization.id, {
      deviceId: hostingString(body, "deviceId", 20, 100),
      title: hostingString(body, "title", 3, 120),
      gpuModel,
      region: hostingString(body, "region", 2, 80),
      cardHourMicrosPerGpuHour: hostingInteger(body, "cardHourMicrosPerGpuHour", 1),
      minRentalSeconds: hostingInteger(body, "minRentalSeconds", 180),
      maxRentalSeconds: hostingInteger(body, "maxRentalSeconds", 180),
      availableFrom: hostingString(body, "availableFrom", 20, 30),
      availableUntil: hostingString(body, "availableUntil", 20, 30),
      approvedImage: hostingString(body, "approvedImage", 15, 300),
      termsVersion: hostingString(body, "termsVersion", 20, 40),
    }, mutation);
    return jsonResponse({ record }, 201, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
