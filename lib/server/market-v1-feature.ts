type MarketV1Environment = Record<string, string | undefined>;

function enabled(value: string | undefined) {
  return ["1", "true"].includes((value ?? "").trim().toLowerCase());
}

export function isMarketV1Enabled(environment: MarketV1Environment = typeof process === "undefined" ? {} : process.env) {
  return enabled(environment.KAI_MARKET_V1);
}
