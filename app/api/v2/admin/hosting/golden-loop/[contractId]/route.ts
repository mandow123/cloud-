import { AccountAuthError } from "@/lib/server/account-auth";
import { requireAdminPermission } from "@/lib/server/admin-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, contextValue: { params: Promise<{ contractId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2SetupEnabled();
    await requireAdminPermission(request, ["AUDIT_READ"]);
    const { contractId } = await contextValue.params;
    if (!/^hctr_[a-f0-9]{32}$/u.test(contractId)) throw new AccountAuthError("HOSTING_CONTRACT_ID_INVALID", 400, "请输入完整的 GPU 租赁合同编号。 ");
    const record = await (await getHostingV2Store()).auditGoldenLoop(contractId, new Date().toISOString());
    if (!record) throw new AccountAuthError("HOSTING_CONTRACT_NOT_FOUND", 404, "没有找到这个 GPU 租赁合同。 ");
    return jsonResponse({ record }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
