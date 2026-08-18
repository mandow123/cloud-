import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { cardHourAdminWrite, requiredText } from "../../../_shared.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ grantId: string }> }) {
  const context = beginApiRequest(request);
  try {
    const write = await cardHourAdminWrite(request, ["SETTLEMENT_OPERATE"]);
    if (!write.admin.principal.roles.includes("FINANCE_APPROVER")) throw new AccountAuthError("CARD_HOUR_GRANT_APPROVER_ROLE_REQUIRED", 403, "试运营卡时审批必须由独立财务审批管理员完成。 ");
    const decision = requiredText(write.body, "decision", 6, 7);
    if (decision !== "APPROVE" && decision !== "REJECT") throw new AccountAuthError("CARD_HOUR_ADMIN_INPUT_INVALID", 400, "审批决定不受支持。 ");
    for (const field of ["requestedBy", "approvedBy", "status", "organizationId", "amountMicros", "payloadHash"]) if (field in write.body) throw new AccountAuthError("CARD_HOUR_ADMIN_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    const { grantId } = await contextValue.params;
    if (!/^chtg_[a-f0-9-]{30,50}$/u.test(grantId)) throw new AccountAuthError("CARD_HOUR_ADMIN_INPUT_INVALID", 400, "试运营卡时申请编号无效。 ");
    const record = await (await getCardHourStore()).decideTrialGrant({
      grantId,
      decision,
      approvedBy: write.admin.principal.id,
      payloadHash: write.payloadHash,
      now: write.now,
    });
    return jsonResponse({ record }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
