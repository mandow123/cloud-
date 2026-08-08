import { requireAccountSession } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { getStandardizationStore } from "@/lib/server/standardization-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    const account = await requireAccountSession(request);
    const response = await (await getStandardizationStore()).getAccountProjection(account.activeOrganization.id);
    return jsonResponse(response, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
