import { jsonResponse } from "@/lib/server/api-guard";
import { readMarketSnapshot } from "@/lib/server/market-snapshot";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { snapshot, source } = await readMarketSnapshot();
    if (new URL(request.url).searchParams.get("summary") === "1") {
      return jsonResponse({
        summary: {
          publishedAt: snapshot.publishedAt,
          quoteCount: snapshot.quotes.length,
          indexCurrent: snapshot.index.current,
          indexChange1d: snapshot.index.change1d,
        },
        source,
        servedAt: new Date().toISOString(),
      });
    }
    return jsonResponse({ snapshot, source, servedAt: new Date().toISOString() });
  } catch {
    return jsonResponse({ error: { code: "MARKET_UNAVAILABLE", message: "行情快照暂时不可用。" } }, 503);
  }
}
