import { AccountAuthError } from "@/lib/server/account-auth";
import { requireAdminPermission } from "@/lib/server/admin-auth";
import { getAccountAuthStore } from "@/lib/server/account-auth-store";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { cardHourAdminWrite, requiredText } from "../_shared.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    await requireAdminPermission(request, ["PAYMENT_READ", "SETTLEMENT_OPERATE"]);
    const rawStatus = new URL(request.url).searchParams.get("status");
    const status = rawStatus === "REQUESTED" || rawStatus === "POSTED" || rawStatus === "REJECTED" ? rawStatus : undefined;
    return jsonResponse({ records: await (await getCardHourStore()).listTrialGrants(status) }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    const write = await cardHourAdminWrite(request, ["SETTLEMENT_OPERATE"]);
    if (!write.admin.principal.roles.includes("ROOT")) throw new AccountAuthError("CARD_HOUR_GRANT_REQUEST_ROLE_REQUIRED", 403, "试运营卡时申请必须由 Root 管理员发起。 ");
    for (const field of ["requestedBy", "approvedBy", "status", "amountMicros", "payloadHash"]) if (field in write.body) throw new AccountAuthError("CARD_HOUR_ADMIN_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    const cardHours = write.body.cardHours;
    if (!Number.isSafeInteger(cardHours) || Number(cardHours) < 1 || Number(cardHours) > 1_000_000) throw new AccountAuthError("CARD_HOUR_ADMIN_INPUT_INVALID", 400, "试运营发放数量必须是 1.00–1,000,000.00 的整数卡时。 ");
    const organizationId = requiredText(write.body, "organizationId", 3, 200);
    const organization = await (await getAccountAuthStore()).getOrganization(organizationId);
    if (!organization || organization.status !== "ACTIVE" || organization.externalKey === "KAI:CLOUD:ROOT") throw new AccountAuthError("CARD_HOUR_GRANT_ORGANIZATION_NOT_FOUND", 404, "目标用户组织不存在或当前不可用。 ");
    const record = await (await getCardHourStore()).requestTrialGrant({
      organizationId,
      amountMicros: Number(cardHours) * 1_000_000,
      reason: requiredText(write.body, "reason", 8, 500),
      requestedBy: write.admin.principal.id,
      idempotencyKey: write.idempotencyKey,
      payloadHash: write.payloadHash,
      now: write.now,
    });
    return jsonResponse({ record }, 201, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
