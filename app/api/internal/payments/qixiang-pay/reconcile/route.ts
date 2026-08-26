import { createHash, timingSafeEqual } from "node:crypto";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { qixiangPayReconciliationReadiness } from "@/lib/server/qixiang-pay";
import { runQixiangReconciliationBatch } from "@/lib/server/qixiang-reconciliation-worker";

export const dynamic = "force-dynamic";

function configuredToken() {
  const token = process.env.KAI_PAYMENT_RECONCILIATION_TOKEN?.trim() ?? "";
  return token.length >= 32 && token.length <= 256 && !/\s/u.test(token) ? token : null;
}

function authorized(request: Request, expected: string) {
  const supplied = request.headers.get("authorization")?.match(/^Bearer ([^\s]{32,256})$/u)?.[1] ?? "";
  const expectedDigest = createHash("sha256").update(expected).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

function response(payload: unknown, status: number) {
  return Response.json(payload, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

export async function POST(request: Request) {
  const token = configuredToken();
  if (!token || !qixiangPayReconciliationReadiness().canReconcilePayment) return response({ error: "RECONCILIATION_UNAVAILABLE" }, 503);
  if (!authorized(request, token)) return response({ error: "UNAUTHORIZED" }, 401);
  if ((request.headers.get("content-length") ?? "0") !== "0") return response({ error: "BODY_NOT_ALLOWED" }, 400);
  try {
    const result = await runQixiangReconciliationBatch(await getCardHourStore());
    return response({ ok: true, result }, 200);
  } catch (error) {
    console.error(JSON.stringify({ event: "qixiang_reconciliation_batch_failed", error: error instanceof Error ? error.name : "UnknownError", occurredAt: new Date().toISOString() }));
    return response({ error: "RECONCILIATION_FAILED" }, 500);
  }
}
