export type MarketplaceCapacityLimits = Readonly<{
  sessions: number;
  requests: number;
  quotes: number;
  drafts: number;
  quotesPerDemand: number;
}>;

type CapacityKey = keyof MarketplaceCapacityLimits;

const CAPACITY_CONFIGURATION: Readonly<Record<CapacityKey, {
  environmentName: string;
  defaultValue: number;
  hardMaximum: number;
}>> = Object.freeze({
  sessions: {
    environmentName: "KAI_MAX_MARKETPLACE_SESSIONS",
    defaultValue: 50_000,
    hardMaximum: 100_000,
  },
  requests: {
    environmentName: "KAI_MAX_MARKETPLACE_REQUESTS",
    defaultValue: 10_000,
    hardMaximum: 50_000,
  },
  quotes: {
    environmentName: "KAI_MAX_MARKETPLACE_QUOTES",
    defaultValue: 50_000,
    hardMaximum: 250_000,
  },
  drafts: {
    environmentName: "KAI_MAX_MARKETPLACE_DRAFTS",
    defaultValue: 20_000,
    hardMaximum: 100_000,
  },
  quotesPerDemand: {
    environmentName: "KAI_MAX_QUOTES_PER_DEMAND",
    defaultValue: 25,
    hardMaximum: 100,
  },
});

function configuredInteger(
  key: CapacityKey,
  environment: Record<string, string | undefined>,
) {
  const configuration = CAPACITY_CONFIGURATION[key];
  const raw = environment[configuration.environmentName];
  if (raw === undefined || raw === "") return configuration.defaultValue;
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error(`MARKETPLACE_CAPACITY_INVALID:${configuration.environmentName}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > configuration.hardMaximum) {
    throw new Error(`MARKETPLACE_CAPACITY_INVALID:${configuration.environmentName}`);
  }
  return value;
}

/**
 * Resolves hard persistence ceilings once when a store starts. Optional
 * overrides remain bounded by compile-time maxima, so a bad deployment value
 * fails readiness instead of silently disabling the protection.
 */
export function resolveMarketplaceCapacityLimits(
  environment: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): MarketplaceCapacityLimits {
  const limits: MarketplaceCapacityLimits = {
    sessions: configuredInteger("sessions", environment),
    requests: configuredInteger("requests", environment),
    quotes: configuredInteger("quotes", environment),
    drafts: configuredInteger("drafts", environment),
    quotesPerDemand: configuredInteger("quotesPerDemand", environment),
  };
  if (limits.quotesPerDemand > limits.quotes) {
    throw new Error("MARKETPLACE_CAPACITY_INVALID:KAI_MAX_QUOTES_PER_DEMAND");
  }
  return Object.freeze(limits);
}

export const marketplaceCapacityEnvironmentNames = Object.freeze(
  Object.values(CAPACITY_CONFIGURATION).map(({ environmentName }) => environmentName),
);
