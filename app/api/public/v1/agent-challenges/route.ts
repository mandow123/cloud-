import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-feature";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { getKaiPublicApiStore } from "@/lib/server/public-api-store";
import { assertKaiPublicOrganization, authorizeKaiPublicApi, kaiPublicAccount, kaiPublicExactKeys, kaiPublicId, kaiPublicMutation, kaiPublicObject } from "@/lib/server/public-api-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2SetupEnabled();
    const principal = await authorizeKaiPublicApi(request, ["agent:write"]);
    const body = kaiPublicObject(await readJsonBody(request));
    kaiPublicExactKeys(body, ["organizationReference", "resourceReference"]);
    const organizationReference = kaiPublicId(body.organizationReference, "organizationReference");
    assertKaiPublicOrganization(principal, organizationReference);
    const resourceReference = kaiPublicId(body.resourceReference, "resourceReference");
    const mutation = await kaiPublicMutation(request, principal, body);
    const challenge = await (await getHostingV2Store()).issueAgentChallenge(kaiPublicAccount(principal), mutation);
    await (await getKaiPublicApiStore()).bindChallenge(mutation, resourceReference, challenge.id);
    const now = Date.now();
    const status = challenge.revokedAt ? "revoked" : challenge.consumedAt ? "consumed" : Date.parse(challenge.expiresAt) <= now ? "expired" : "pending";
    return jsonResponse({ record: {
      id: challenge.id,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      status,
      minimumAgentVersion: challenge.minimumAgentVersion,
      allowedClockSkewSeconds: 60,
      // Agent 1.9.7 already trusts this signed transport. The route links the
      // resulting device back to the public challenge without exposing OAuth.
      registerEndpoint: new URL("/api/v2/agent/register", request.url).toString(),
    } }, 201, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
