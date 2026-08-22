import { assertAccountAuthSameOrigin, AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, mutationHash, readJsonBody, requireIdempotencyKey } from "@/lib/server/api-guard";
import { requireAdminPermission } from "@/lib/server/admin-auth";
import { getCardHourStore, type CardHourTopupAppealStatus } from "@/lib/server/card-hour-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    await requireAdminPermission(request, ["PAYMENT_READ", "APPEAL_READ"]);
    const params = new URL(request.url).searchParams;
    const pageText = params.get("page") ?? "1";
    const pageSizeText = params.get("pageSize") ?? "20";
    if (!/^\d{1,6}$/u.test(pageText) || Number(pageText) < 1) throw new AccountAuthError("CARD_HOUR_TOPUP_APPEAL_PAGE_INVALID", 400, "分页页码无效。 ");
    if (!/^\d{1,2}$/u.test(pageSizeText) || Number(pageSizeText) < 1 || Number(pageSizeText) > 50) throw new AccountAuthError("CARD_HOUR_TOPUP_APPEAL_PAGE_SIZE_INVALID", 400, "每页数量必须在 1 至 50 之间。 ");
    const statusText = params.get("status")?.trim() ?? "";
    const statuses = ["OPEN", "UNDER_REVIEW", "RESOLVED", "CLOSED"] as const;
    if (statusText && !statuses.includes(statusText as CardHourTopupAppealStatus)) throw new AccountAuthError("CARD_HOUR_TOPUP_APPEAL_STATUS_INVALID", 400, "申诉状态筛选无效。 ");
    const orderId = params.get("orderId")?.trim() ?? "";
    const organizationId = params.get("organizationId")?.trim() ?? "";
    if (orderId && (orderId.length > 96 || !/^[A-Za-z0-9_-]+$/u.test(orderId))) throw new AccountAuthError("CARD_HOUR_TOPUP_APPEAL_ORDER_FILTER_INVALID", 400, "付款单筛选内容无效。 ");
    if (organizationId && (organizationId.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(organizationId))) throw new AccountAuthError("CARD_HOUR_TOPUP_APPEAL_ORGANIZATION_FILTER_INVALID", 400, "组织筛选内容无效。 ");
    const result = await (await getCardHourStore()).listTopupAppeals({
      page: Number(pageText), pageSize: Number(pageSizeText),
      status: statusText ? statusText as CardHourTopupAppealStatus : undefined,
      orderId: orderId || undefined, organizationId: organizationId || undefined,
    });
    return jsonResponse(result, 200, { "cache-control": "private, no-store" }, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    assertAccountAuthSameOrigin(request);
    const admin = await requireAdminPermission(request, ["PAYMENT_READ", "OFFLINE_REFUND_RECORD"]);
    const input = await readJsonBody(request) as { appealId?: unknown; action?: unknown; expectedVersion?: unknown; resolutionNote?: unknown };
    if (typeof input.appealId !== "string" || !/^chta_[0-9a-f-]{36}$/u.test(input.appealId)) throw new AccountAuthError("CARD_HOUR_TOPUP_APPEAL_NOT_FOUND", 404, "充值申诉不存在。 ");
    if (input.action !== "START_REVIEW" && input.action !== "RESOLVE" && input.action !== "CLOSE") throw new AccountAuthError("CARD_HOUR_TOPUP_APPEAL_ACTION_INVALID", 400, "充值申诉操作无效。 ");
    if (!Number.isSafeInteger(input.expectedVersion)) throw new AccountAuthError("CARD_HOUR_TOPUP_APPEAL_VERSION_INVALID", 400, "申诉版本无效。 ");
    const payloadHash = await mutationHash(input);
    requireIdempotencyKey(request);
    const result = await (await getCardHourStore()).transitionTopupAppeal({
      appealId: input.appealId,
      action: input.action,
      expectedVersion: input.expectedVersion as number,
      resolutionNote: typeof input.resolutionNote === "string" ? input.resolutionNote : undefined,
      adminPrincipalId: admin.principal.id,
      payloadHash,
      now: new Date().toISOString(),
    });
    return jsonResponse(result, 200, { "cache-control": "private, no-store" }, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
