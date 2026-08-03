import { beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { marketIndexChange, readMarketSnapshot } from "@/lib/server/market-snapshot";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    const { snapshot, source } = await readMarketSnapshot();
    if (new URL(request.url).searchParams.get("summary") === "1") {
      return jsonResponse({
        summary: {
          publishedAt: snapshot.publishedAt,
          quoteCount: snapshot.quotes.length,
          indexCurrent: snapshot.index.current,
          indexChange1d: snapshot.index.change1d,
          indexChange7d: marketIndexChange(snapshot, 7),
          indexChange30d: snapshot.index.change30d,
        },
        source,
        servedAt: new Date().toISOString(),
      }, 200, undefined, context);
    }
    return jsonResponse({ snapshot, source, servedAt: new Date().toISOString() }, 200, undefined, context);
  } catch {
    return jsonResponse({ error: { code: "MARKET_UNAVAILABLE", message: "行情快照暂时不可用。", requestId: context.requestId } }, 503, undefined, { ...context, errorCode: "MARKET_UNAVAILABLE", errorName: "MarketSnapshotError" });
  }
}
