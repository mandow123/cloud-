import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { getStandardizationStore } from "@/lib/server/standardization-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    const response = await (await getStandardizationStore()).getQuotes();
    return jsonResponse(response, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
