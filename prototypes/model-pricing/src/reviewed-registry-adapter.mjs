import { fail } from "./errors.mjs";
import { reviewedRegionHash } from "./hash.mjs";
import { fetchText } from "./http.mjs";
import { httpsUrl, normalizeQuote, requiredString, validateQuoteSet } from "./schema.mjs";

export const REVIEW_REGISTRY_SCHEMA = "kai-reviewed-price-registry/1";

export function parseReviewedRegistry(registryText, pageHtml, config) {
  let registry;
  try {
    registry = JSON.parse(registryText);
  } catch (error) {
    fail("INVALID_REGISTRY", "Reviewed registry is not valid JSON", { cause: error });
  }
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    fail("INVALID_REGISTRY", "Reviewed registry root must be an object");
  }
  if (registry.schemaVersion !== REVIEW_REGISTRY_SCHEMA) {
    fail("REGISTRY_SCHEMA_CHANGED", `Unexpected registry schema version: ${String(registry.schemaVersion)}`);
  }
  const provider = requiredString(registry.provider, "registry.provider");
  if (provider !== config.expectedProvider) {
    fail("PROVIDER_MISMATCH", `Expected provider ${config.expectedProvider}, received ${provider}`);
  }
  if (registry.sourceUrl !== config.sourceUrl) {
    fail("SOURCE_URL_MISMATCH", "Registry source URL does not match adapter configuration");
  }
  const actualHash = reviewedRegionHash(pageHtml);
  const expectedHash = requiredString(registry.reviewedContentSha256, "registry.reviewedContentSha256", 64);
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    fail("INVALID_REGISTRY_HASH", "Reviewed content hash must be a lowercase SHA-256 value");
  }
  if (actualHash !== expectedHash) {
    fail("CONTENT_CHANGED", `Pricing page content changed; expected ${expectedHash}, received ${actualHash}`);
  }
  if (!Array.isArray(registry.entries) || registry.entries.length === 0) {
    fail("INVALID_REGISTRY", "Reviewed registry entries must be a non-empty array");
  }
  const quotes = registry.entries.map((entry) => normalizeQuote(entry, {
    provider,
    sourceUrl: registry.sourceUrl,
    fetchedAt: config.fetchedAt,
    sourceKind: "official_page_reviewed",
    sourceContentHash: actualHash,
  }));
  return validateQuoteSet(quotes);
}

export async function collectReviewedRegistry(config) {
  const sourceUrl = httpsUrl(config.sourceUrl, "sourceUrl");
  const { text: pageHtml } = await fetchText(sourceUrl, {
    fetchImpl: config.fetchImpl,
    timeoutMs: config.timeoutMs,
    accept: "text/html,application/xhtml+xml",
  });
  return parseReviewedRegistry(config.registryText, pageHtml, config);
}
