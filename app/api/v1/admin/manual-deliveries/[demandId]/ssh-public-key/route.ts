import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireAdminPermission } from "@/lib/server/admin-auth";
import { getAdminOperationsStore } from "@/lib/server/admin-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, contextValue: { params: Promise<{ demandId: string }> }) {
  const context = beginApiRequest(request);
  try {
    const auth = await requireAdminPermission(request, ["FULFILLMENT_READ"]);
    const { demandId } = await contextValue.params;
    const record = await (await getAdminOperationsStore()).revealManualDeliveryPublicKey(auth.principal.id, demandId);
    return jsonResponse({ record }, 200, { "cache-control": "no-store, max-age=0" }, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
