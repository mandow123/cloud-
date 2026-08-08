import {
  StandardizationIdempotencyError,
  StandardizationInputError,
  StandardizationSnapshotConflictError,
  parseAppendStandardizationSnapshot,
} from "@/lib/standardization";
import { requireAdminPermission } from "@/lib/server/admin-auth";
import {
  apiErrorResponse,
  beginApiRequest,
  jsonResponse,
  mutationHash,
  readJsonBody,
  requireIdempotencyKey,
} from "@/lib/server/api-guard";
import { getStandardizationStore } from "@/lib/server/standardization-store";
import { adminQuery, adminRead } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return adminRead(request, ["MARKET_READ"], (store) => (
    store.readProjection("standardization", adminQuery(request))
  ));
}

function validationResponse(error: StandardizationInputError, requestId: string) {
  return {
    error: {
      code: "VALIDATION_ERROR",
      message: error.message,
      field: error.field,
      requestId,
    },
  };
}

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    const auth = await requireAdminPermission(request, ["MARKET_PUBLISH"]);
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new StandardizationInputError("快照发布请求必须是对象。");
    }
    const values = body as Record<string, unknown>;
    if ("actorId" in values || "payloadHash" in values) {
      throw new StandardizationInputError("发布人和内容摘要只能由服务器生成。");
    }
    const reason = typeof values.reason === "string" ? values.reason.trim() : "";
    if (reason.length < 8 || reason.length > 500) {
      throw new StandardizationInputError("发布原因必须为 8 至 500 个字符。", "reason");
    }
    const snapshot = parseAppendStandardizationSnapshot(values);
    const result = await (await getStandardizationStore()).appendSnapshot({
      actorId: auth.principal.id,
      idempotencyKey: requireIdempotencyKey(request),
      payloadHash: await mutationHash(body),
      reason,
    }, snapshot);
    return jsonResponse(
      result,
      result.replayed ? 200 : 201,
      { "idempotency-replayed": String(result.replayed) },
      context,
    );
  } catch (error) {
    if (error instanceof StandardizationInputError) {
      return jsonResponse(validationResponse(error, context.requestId), 400, undefined, {
        ...context,
        errorCode: "VALIDATION_ERROR",
        errorName: error.name,
      });
    }
    if (error instanceof StandardizationIdempotencyError) {
      return jsonResponse({
        error: {
          code: "IDEMPOTENCY_CONFLICT",
          message: "同一提交标识对应了不同内容，请刷新后重试。",
          requestId: context.requestId,
        },
      }, 409, undefined, {
        ...context,
        errorCode: "IDEMPOTENCY_CONFLICT",
        errorName: error.name,
      });
    }
    if (error instanceof StandardizationSnapshotConflictError) {
      return jsonResponse({
        error: {
          code: "SNAPSHOT_CONFLICT",
          message: "该行情时点已经发布过快照，请刷新后查看现有记录。",
          requestId: context.requestId,
        },
      }, 409, undefined, {
        ...context,
        errorCode: "SNAPSHOT_CONFLICT",
        errorName: error.name,
      });
    }
    return apiErrorResponse(error, undefined, context);
  }
}
