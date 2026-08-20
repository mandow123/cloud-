import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { getKaiPublicApiStore } from "@/lib/server/public-api-store";
import { authorizeKaiPublicApi, kaiPublicId, kaiPublicVerificationState, kaiPublicVerificationView } from "@/lib/server/public-api-service";
import { deliverOneKaiPublicWebhook } from "@/lib/server/public-api-webhook";

export const dynamic = "force-dynamic";

export async function GET(request: Request, contextValue: { params: Promise<{ verificationId: string }> }) {
  const context = beginApiRequest(request);
  try {
    const principal = await authorizeKaiPublicApi(request, ["resource:read"]);
    const { verificationId: rawId } = await contextValue.params;
    const verificationId = kaiPublicId(rawId, "verificationId");
    const publicStore = await getKaiPublicApiStore();
    let record = await publicStore.getVerification(principal.clientId, verificationId);
    if (!record) throw new AccountAuthError("RESOURCE_NOT_FOUND", 404, "资源验证不存在。 ");
    if (record.deviceId && record.status !== "revoked") {
      const device = await (await getHostingV2Store()).getDevice(record.deviceId);
      if (!device || device.organizationId !== principal.organizationId) throw new AccountAuthError("RESOURCE_NOT_FOUND", 404, "资源验证不存在。 ");
      const state = kaiPublicVerificationState(device);
      record = await publicStore.syncVerification(principal.clientId, device.id, state.status, state.failure, new Date().toISOString()) ?? record;
      await deliverOneKaiPublicWebhook({ store: publicStore });
    }
    return jsonResponse({ record: kaiPublicVerificationView(record) }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
