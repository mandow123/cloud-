import { beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { readMarketSnapshot } from "@/lib/server/market-snapshot";
import { assertMarketplaceSecurityConfiguration, getMarketplaceStore } from "@/lib/server/marketplace-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    await assertMarketplaceSecurityConfiguration();
    const store = await getMarketplaceStore();
    const [health, market] = await Promise.all([store.health(), readMarketSnapshot()]);
    const publishedAt = new Date(market.snapshot.publishedAt);
    const ageHours = Number.isNaN(publishedAt.getTime())
      ? null
      : (Date.now() - publishedAt.getTime()) / 3_600_000;
    const marketStale = ageHours === null || ageHours > 26 || ageHours < -1;
    const marketReady = market.source === "persistent" && !marketStale;
    const ready = health.integrity === "ok" && marketReady;
    return jsonResponse({
      status: ready ? "ok" : "error",
      check: "ready",
      service: "kai-cloud-marketplace",
      release: typeof process !== "undefined" ? (process.env.KAI_RELEASE_SHA ?? "development") : "worker",
      database: {
        backend: health.backend,
        schemaVersion: health.schemaVersion,
        integrity: health.integrity,
      },
      market: {
        source: market.source,
        publishedAt: market.snapshot.publishedAt,
        ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
        stale: marketStale,
        ready: marketReady,
      },
      checkedAt: new Date().toISOString(),
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
