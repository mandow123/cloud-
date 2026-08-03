import { fail } from "./errors.mjs";

export const ALLOWED_CURRENCIES = new Set(["CNY", "USD"]);
export const PRICING_UNIT = "per_million_tokens";
export const VERIFIED_STATUS = "verified";

function assertObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("SCHEMA_MISMATCH", `${path} must be an object`);
  }
  return value;
}
export function requiredString(value, path, maxLength = 160) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("SCHEMA_MISMATCH", `${path} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    fail("SCHEMA_MISMATCH", `${path} exceeds ${maxLength} characters`);
  }
  return normalized;
}

export function isoTimestamp(value, path) {
  const normalized = requiredString(value, path, 64);
  if (!Number.isFinite(Date.parse(normalized))) {
    fail("SCHEMA_MISMATCH", `${path} must be an ISO timestamp`);
  }
  return new Date(normalized).toISOString();
}

export function httpsUrl(value, path) {
  const normalized = requiredString(value, path, 2048);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail("SCHEMA_MISMATCH", `${path} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    fail("SCHEMA_MISMATCH", `${path} must use HTTPS`);
  }
  return parsed.toString();
}

function price(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    fail("INVALID_PRICE", `${path} must be a finite number between 0 and 1,000,000`);
  }
  return value;
}

export function normalizeQuote(raw, context) {
  const row = assertObject(raw, "quote");
  const currency = requiredString(row.currency, "quote.currency", 3).toUpperCase();
  if (!ALLOWED_CURRENCIES.has(currency)) {
    fail("UNSUPPORTED_CURRENCY", `quote.currency ${currency} is not allowed`);
  }
  const unit = requiredString(row.unit, "quote.unit", 40);
  if (unit !== PRICING_UNIT) {
    fail("UNSUPPORTED_UNIT", `quote.unit must be ${PRICING_UNIT}`);
  }

  return Object.freeze({
    provider: requiredString(context.provider, "provider"),
    model: requiredString(row.model, "quote.model"),
    version: requiredString(row.version, "quote.version"),
    inputPrice: price(row.inputPrice, "quote.inputPrice"),
    cachedInputPrice: price(row.cachedInputPrice, "quote.cachedInputPrice", { nullable: true }),
    outputPrice: price(row.outputPrice, "quote.outputPrice"),
    currency,
    pricingUnit: unit,
    sourceUrl: httpsUrl(context.sourceUrl, "sourceUrl"),
    fetchedAt: isoTimestamp(context.fetchedAt, "fetchedAt"),
    effectiveAt: isoTimestamp(row.effectiveAt, "quote.effectiveAt"),
    status: VERIFIED_STATUS,
    sourceKind: requiredString(context.sourceKind, "sourceKind", 40),
    sourceContentHash: requiredString(context.sourceContentHash, "sourceContentHash", 64),
  });
}

export function validateQuoteSet(quotes) {
  if (!Array.isArray(quotes) || quotes.length === 0) {
    fail("EMPTY_FEED", "A publishable feed must contain at least one quote");
  }
  const identities = new Set();
  for (const quote of quotes) {
    if (!quote || quote.status !== VERIFIED_STATUS) {
      fail("UNVERIFIED_QUOTE", "Every quote must pass normalization before publication");
    }
    const identity = [quote.provider, quote.model, quote.version, quote.currency, quote.pricingUnit].join("|");
    if (identities.has(identity)) {
      fail("DUPLICATE_QUOTE", `Duplicate quote identity: ${identity}`);
    }
    identities.add(identity);
  }
  return quotes;
}
