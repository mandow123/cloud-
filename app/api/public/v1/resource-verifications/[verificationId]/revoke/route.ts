import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { getKaiPublicApiStore } from "@/lib/server/public-api-store";
import { authorizeKaiPublicApi, kaiPublicExactKeys, kaiPublicId, kaiPublicMutation, kaiPublicObject, kaiPublicVerificationView } from "@/lib/server/public-api-service";
import { deliverOneKaiPublicWebhook } from "@/lib/server/public-api-webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ verificationId: string }> }) {
  const context = beginApiRequest(request);
  try {
    const principal = await authorizeKaiPublicApi(request, ["resource:read", "verification:write"]);
    const body = kaiPublicObject(await readJsonBody(request));
    kaiPublicExactKeys(body, []);
    const { verificationId: rawId } = await contextValue.params;
    const result = await (await getKaiPublicApiStore()).revokeVerification(await kaiPublicMutation(request, principal, body), kaiPublicId(rawId, "verificationId"));
    await deliverOneKaiPublicWebhook();
    return jsonResponse({ record: kaiPublicVerificationView(result.record) }, 200, { "idempotency-replayed": String(result.replayed) }, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
