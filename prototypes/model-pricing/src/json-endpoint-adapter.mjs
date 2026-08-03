import { fail } from "./errors.mjs";
import { fetchText } from "./http.mjs";
import { sha256 } from "./hash.mjs";
import { httpsUrl, isoTimestamp, normalizeQuote, requiredString, validateQuoteSet } from "./schema.mjs";

export const OFFICIAL_FEED_SCHEMA = "kai-official-price-feed/1";

export function parseOfficialJsonFeed(bodyText, config) {
  let document;
  try {
    document = JSON.parse(bodyText);
  } catch (error) {
    fail("INVALID_JSON", "Official endpoint did not return valid JSON", { cause: error });
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    fail("SCHEMA_MISMATCH", "Official feed root must be an object");
  }
  if (document.schemaVersion !== (config.expectedSchemaVersion ?? OFFICIAL_FEED_SCHEMA)) {
    fail("SCHEMA_VERSION_CHANGED", `Unexpected official feed schema version: ${String(document.schemaVersion)}`);
  }
  const provider = requiredString(document.provider, "provider");
  if (provider !== config.expectedProvider) {
    fail("PROVIDER_MISMATCH", `Expected provider ${config.expectedProvider}, received ${provider}`);
  }
  if (!Array.isArray(document.items) || document.items.length === 0) {
    fail("SCHEMA_MISMATCH", "Official feed items must be a non-empty array");
  }
  const publishedAt = isoTimestamp(document.publishedAt, "publishedAt");
  const sourceContentHash = sha256(bodyText);
  const quotes = document.items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      fail("SCHEMA_MISMATCH", `items[${index}] must be an object`);
    }
    if (!item.pricing || typeof item.pricing !== "object" || Array.isArray(item.pricing)) {
      fail("SCHEMA_MISMATCH", `items[${index}].pricing must be an object`);
    }
    for (const field of ["input", "cachedInput", "output", "currency", "unit"]) {
      if (!Object.hasOwn(item.pricing, field)) {
        fail("SCHEMA_MISMATCH", `items[${index}].pricing.${field} is required; null is allowed only for cachedInput`);
      }
    }
    return normalizeQuote({
      model: item.model,
      version: item.version,
      inputPrice: item.pricing.input,
      cachedInputPrice: item.pricing.cachedInput,
      outputPrice: item.pricing.output,
      currency: item.pricing.currency,
      unit: item.pricing.unit,
      effectiveAt: item.effectiveAt ?? publishedAt,
    }, {
      provider,
      sourceUrl: config.sourceUrl,
      fetchedAt: config.fetchedAt,
      sourceKind: "official_json",
      sourceContentHash,
    });
  });
  return validateQuoteSet(quotes);
}

export async function collectOfficialJsonFeed(config) {
  const endpointUrl = httpsUrl(config.endpointUrl, "endpointUrl");
  const { text, contentType } = await fetchText(endpointUrl, {
    fetchImpl: config.fetchImpl,
    timeoutMs: config.timeoutMs,
    accept: "application/json",
  });
  if (contentType && !contentType.toLowerCase().includes("json")) {
    fail("UNEXPECTED_CONTENT_TYPE", `Official endpoint returned ${contentType}`);
  }
  return parseOfficialJsonFeed(text, config);
}
