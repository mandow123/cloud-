import { accountAuthErrorResponse } from "@/lib/server/account-auth";
import { activityEnvironment } from "@/lib/server/activity-env";
import { ActivityHttpError, activityErrorResponse, assertActivitySameOrigin, requireActivityAdminAccess } from "@/lib/server/activity-identity";
import { activityPayloadHash, moderateActivitySubmission, readActivityAdminRows } from "@/lib/server/activity-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireActivityAdminAccess(request, "READ");
    const { DB } = await activityEnvironment();
    return Response.json({ items: await readActivityAdminRows(DB) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ActivityHttpError) return activityErrorResponse(error);
    return accountAuthErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertActivitySameOrigin(request);
    const admin = await requireActivityAdminAccess(request, "MODERATE");
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new ActivityHttpError("ACTIVITY_JSON_REQUIRED", 400, "请求必须使用 JSON。 ");
    const length = Number(request.headers.get("content-length"));
    if (!Number.isSafeInteger(length) || length < 1 || length > 16 * 1024) throw new ActivityHttpError("ACTIVITY_PAYLOAD_TOO_LARGE", 413, "请求正文大小无效或过大。 ");
    const body = await request.json() as Record<string, unknown>;
    const submissionId = typeof body.submissionId === "string" ? body.submissionId : "";
    const action = typeof body.action === "string" ? body.action : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!/^sub_[0-9a-f-]{36}$/u.test(submissionId) || !["PUBLISH", "REJECT", "GRANT_REWARD", "REVOKE_REWARD"].includes(action) || reason.length < 8 || reason.length > 500) throw new ActivityHttpError("ACTIVITY_ADMIN_INPUT_INVALID", 400, "管理操作参数无效，理由至少 8 个字符。 ");
    const units = body.units == null ? undefined : Number(body.units);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!/^kai-[A-Za-z0-9._:-]{8,124}$/u.test(idempotencyKey)) throw new ActivityHttpError("ACTIVITY_IDEMPOTENCY_REQUIRED", 400, "管理操作缺少有效的幂等键。 ");
    const { DB } = await activityEnvironment();
    const payloadHash = await activityPayloadHash({ submissionId, action, reason, units: units ?? null });
    const result = await moderateActivitySubmission(DB, { submissionId, action: action as "PUBLISH" | "REJECT" | "GRANT_REWARD" | "REVOKE_REWARD", reason, units, adminId: admin.id, idempotencyKey, payloadHash });
    return Response.json({ record: result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ActivityHttpError) return activityErrorResponse(error);
    return accountAuthErrorResponse(error);
  }
}
