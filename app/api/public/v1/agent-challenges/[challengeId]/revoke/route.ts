import { apiErrorResponse, beginApiRequest, readJsonBody } from "@/lib/server/api-guard";
import { requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-feature";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { getKaiPublicApiStore } from "@/lib/server/public-api-store";
import { authorizeKaiPublicApi, kaiPublicExactKeys, kaiPublicId, kaiPublicMutation, kaiPublicObject } from "@/lib/server/public-api-service";
import { AccountAuthError } from "@/lib/server/account-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ challengeId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2SetupEnabled();
    const principal = await authorizeKaiPublicApi(request, ["agent:write"]);
    const body = kaiPublicObject(await readJsonBody(request));
    kaiPublicExactKeys(body, []);
    const { challengeId: rawId } = await contextValue.params;
    const challengeId = kaiPublicId(rawId, "challengeId");
    if (!await (await getKaiPublicApiStore()).getChallengeBinding(principal.clientId, challengeId)) throw new AccountAuthError("RESOURCE_NOT_FOUND", 404, "Agent Challenge 不存在。 ");
    await (await getHostingV2Store()).revokeAgentChallenge(principal.organizationId, challengeId, await kaiPublicMutation(request, principal, body));
    return new Response(null, { status: 204, headers: { "cache-control": "no-store", "x-request-id": context.requestId } });
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
