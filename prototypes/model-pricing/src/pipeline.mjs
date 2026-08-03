import { PricingPrototypeError } from "./errors.mjs";
import { validateQuoteSet } from "./schema.mjs";

function failureFrom(error) {
  if (error instanceof PricingPrototypeError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return { code: "UNEXPECTED_FAILURE", message: "Collector failed unexpectedly", retryable: false };
}
export async function runAtomicCollection(metadata, collect) {
  try {
    const quotes = validateQuoteSet(await collect());
    return Object.freeze({
      provider: metadata.provider,
      sourceKind: metadata.sourceKind,
      sourceUrl: metadata.sourceUrl,
      fetchedAt: metadata.fetchedAt,
      state: "publishable",
      quotes: Object.freeze([...quotes]),
      failure: null,
    });
  } catch (error) {
    const failure = failureFrom(error);
    return Object.freeze({
      provider: metadata.provider,
      sourceKind: metadata.sourceKind,
      sourceUrl: metadata.sourceUrl,
      fetchedAt: metadata.fetchedAt,
      state: failure.code === "CONTENT_CHANGED" ? "review_required" : "blocked",
      quotes: Object.freeze([]),
      failure: Object.freeze(failure),
    });
  }
}

export function createPublicationCandidate(batches) {
  if (!Array.isArray(batches) || batches.length === 0) {
    throw new TypeError("At least one collection batch is required");
  }
  const publishableBatches = batches.filter((batch) => batch.state === "publishable");
  const quotes = publishableBatches.flatMap((batch) => batch.quotes);
  if (quotes.length === 0) {
    return Object.freeze({ state: "blocked", quotes: Object.freeze([]), reason: "NO_VERIFIED_QUOTES" });
  }
  validateQuoteSet(quotes);
  return Object.freeze({
    state: "publishable",
    quotes: Object.freeze(quotes),
    sourceSummary: Object.freeze(batches.map((batch) => ({
      provider: batch.provider,
      state: batch.state,
      failureCode: batch.failure?.code ?? null,
    }))),
  });
}
