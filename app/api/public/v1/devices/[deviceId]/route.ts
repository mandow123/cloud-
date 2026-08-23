import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { getKaiPublicApiStore } from "@/lib/server/public-api-store";
import { authorizeKaiPublicApi, kaiPublicDeviceView, kaiPublicId, kaiPublicVerificationState } from "@/lib/server/public-api-service";
import { deliverOneKaiPublicWebhook } from "@/lib/server/public-api-webhook";

export const dynamic = "force-dynamic";

export async function GET(request: Request, contextValue: { params: Promise<{ deviceId: string }> }) {
  const context = beginApiRequest(request);
  try {
    const principal = await authorizeKaiPublicApi(request, ["resource:read"]);
    const { deviceId: rawId } = await contextValue.params;
    const deviceId = kaiPublicId(rawId, "deviceId");
    const device = await (await getHostingV2Store()).getDevice(deviceId);
    if (!device || device.organizationId !== principal.organizationId) throw new AccountAuthError("RESOURCE_NOT_FOUND", 404, "设备不存在。 ");
    const state = kaiPublicVerificationState(device);
    const publicStore = await getKaiPublicApiStore();
    const verification = await publicStore.syncVerification(principal.clientId, deviceId, state.status, state.failure, new Date().toISOString());
    if (!verification) throw new AccountAuthError("RESOURCE_NOT_FOUND", 404, "设备不存在。 ");
    await deliverOneKaiPublicWebhook({ store: publicStore });
    return jsonResponse({ record: kaiPublicDeviceView(device) }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
