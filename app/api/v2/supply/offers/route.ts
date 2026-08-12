import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { hostingInteger, hostingMutationContext, hostingObject, hostingString, hostingSupplierOfferClientView, requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-api";
import { hostingV2CurrentTermsVersion } from "@/lib/server/hosting-v2-image-policy";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2SetupEnabled();
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const dashboard = await (await getHostingV2Store()).dashboard(account.activeOrganization.id, new Date().toISOString());
    return jsonResponse({ records: dashboard.offers.map(hostingSupplierOfferClientView) }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2SetupEnabled();
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const body = hostingObject(await readJsonBody(request));
    for (const field of ["actorId", "accountId", "organizationId", "feeScheduleId", "payloadHash", "status", "version", "id", "gpuModel", "termsVersion"]) {
      if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    }
    const store = await getHostingV2Store();
    const deviceId = hostingString(body, "deviceId", 20, 100);
    const dashboard = await store.dashboard(account.activeOrganization.id, new Date().toISOString());
    const device = dashboard.devices.find((record) => record.id === deviceId);
    if (!device) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "deviceId 不属于当前供应主体。 ");
    const mutation = await hostingMutationContext(request, account.account.id, body);
    const record = await store.createOffer(account.activeOrganization.id, {
      deviceId,
      title: hostingString(body, "title", 3, 120),
      gpuModel: device.inventory.gpuModel,
      region: hostingString(body, "region", 2, 80),
      cardHourMicrosPerGpuHour: hostingInteger(body, "cardHourMicrosPerGpuHour", 1),
      minRentalSeconds: hostingInteger(body, "minRentalSeconds", 180),
      maxRentalSeconds: hostingInteger(body, "maxRentalSeconds", 180),
      availableFrom: hostingString(body, "availableFrom", 20, 30),
      availableUntil: hostingString(body, "availableUntil", 20, 30),
      approvedImage: hostingString(body, "approvedImage", 15, 300),
      termsVersion: hostingV2CurrentTermsVersion(),
    }, mutation);
    return jsonResponse({ record: hostingSupplierOfferClientView(record) }, 201, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
