import bundledSnapshot from "@/data/model-market.snapshot.json";
import { calendarIndexChange } from "@/scripts/model-market/history.mjs";

type BundledMarketSnapshot = typeof bundledSnapshot;
type MarketSnapshot = Omit<BundledMarketSnapshot, "index"> & {
  index: Omit<BundledMarketSnapshot["index"], "change1d" | "change30d"> & {
    change1d: number | null;
    change30d: number | null;
  };
};

export function marketIndexChange(snapshot: MarketSnapshot, days: number) {
  const history = Array.isArray(snapshot.index.history) ? snapshot.index.history : [];
  const currentPoint = history[history.length - 1];
  if (!currentPoint) return null;
  return calendarIndexChange(history, currentPoint.date, snapshot.index.current, days);
}

function normalizeIndexChanges(snapshot: MarketSnapshot): MarketSnapshot {
  return {
    ...snapshot,
    index: {
      ...snapshot.index,
      change1d: marketIndexChange(snapshot, 1),
      change30d: marketIndexChange(snapshot, 30),
    },
  };
}

function isSnapshot(value: unknown): value is MarketSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<MarketSnapshot>;
  return candidate.schemaVersion === "kai-model-market-snapshot/1"
    && typeof candidate.publishedAt === "string"
    && Array.isArray(candidate.quotes)
    && candidate.quotes.length >= 30
    && Boolean(candidate.index && typeof candidate.index === "object");
}

export async function readMarketSnapshot(): Promise<{ snapshot: MarketSnapshot; source: "persistent" | "bundled" }> {
  const dataDirectory = typeof process !== "undefined"
    ? (process.env.KAI_MARKET_DATA_DIR ?? process.env.KAI_DATA_DIR)
    : undefined;
  if (!dataDirectory) {
    return {
      snapshot: normalizeIndexChanges(bundledSnapshot as MarketSnapshot),
      source: "bundled",
    };
  }

  try {
    const [{ readFile }, { join }] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    const raw = await readFile(join(dataDirectory, "model-market.snapshot.json"), "utf8");
    const candidate = JSON.parse(raw) as unknown;
    if (isSnapshot(candidate)) {
      return { snapshot: normalizeIndexChanges(candidate), source: "persistent" };
    }
  } catch {
    // A failed or incomplete scheduled update never replaces the last bundled snapshot.
  }

  return {
    snapshot: normalizeIndexChanges(bundledSnapshot as MarketSnapshot),
    source: "bundled",
  };
}
