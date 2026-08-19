import { getAccountConsoleSummary } from "@/lib/server/account-console-summary";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    const summary = await getAccountConsoleSummary(request);
    return jsonResponse(summary, 200, { "cache-control": "private, no-store" }, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
