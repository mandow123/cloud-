import bundledSnapshot from "@/data/model-market.snapshot.json";

type MarketSnapshot = typeof bundledSnapshot;

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
  const dataDirectory = typeof process !== "undefined" ? process.env.KAI_DATA_DIR : undefined;
  if (!dataDirectory) return { snapshot: bundledSnapshot, source: "bundled" };

  try {
    const [{ readFile }, { join }] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    const raw = await readFile(join(dataDirectory, "model-market.snapshot.json"), "utf8");
    const candidate = JSON.parse(raw) as unknown;
    if (isSnapshot(candidate)) return { snapshot: candidate, source: "persistent" };
  } catch {
    // A failed or incomplete scheduled update never replaces the last bundled snapshot.
  }

  return { snapshot: bundledSnapshot, source: "bundled" };
}
