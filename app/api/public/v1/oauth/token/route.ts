import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { issueKaiPublicApiToken, parseKaiPublicApiTokenRequest } from "@/lib/server/public-api-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    const { client, scope } = await parseKaiPublicApiTokenRequest(request);
    const token = await issueKaiPublicApiToken({ ...client, scopes: scope });
    return jsonResponse({ access_token: token.accessToken, token_type: "Bearer", expires_in: token.expiresIn, scope: token.scope }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
