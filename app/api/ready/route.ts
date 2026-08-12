import { beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { evaluateReadiness } from "@/lib/server/readiness";
import { isLocalHostingAcceptance } from "@/lib/server/hosting-v2-transaction-gate";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    const readiness=await evaluateReadiness();
    const ready=readiness.ready;
    return jsonResponse({
      status: ready ? "ok" : "error",
      check: "ready",
      service: "kai-cloud-marketplace",
      release: typeof process !== "undefined" ? (process.env.KAI_RELEASE_SHA ?? "development") : "worker",
      environment: {
        localAcceptance: isLocalHostingAcceptance(),
      },
      database:readiness.database,
      market:readiness.market,
      storage:readiness.storage,
      capabilities:readiness.capabilities,
      hostingV2:readiness.hostingV2,
      checkedAt: new Date().toISOString(),
      ...(ready?{}:{requestId:context.requestId}),
    }, ready ? 200 : 503, undefined, ready ? context : { ...context, errorCode: "NOT_READY" });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "readiness_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown failure",
      occurredAt: new Date().toISOString(),
    }));
    return jsonResponse({ status: "error", check: "ready", service: "kai-cloud-marketplace", requestId: context.requestId }, 503, undefined, { ...context, errorCode: "READINESS_FAILED", errorName: error instanceof Error ? error.name : "UnknownError" });
  }
}
