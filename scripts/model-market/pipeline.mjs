import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { fetchJsonWithRetry, fetchTextWithRetry } from "./http.mjs";

export const PENDING_SCHEMA = "kai-model-market-pending/1";
export const SNAPSHOT_SCHEMA = "kai-model-market-snapshot/1";
export const ECB_DAILY_FX_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const LITELLM_CATALOG_URL = "https://cdn.jsdelivr.net/gh/BerriAI/litellm@main/model_prices_and_context_window.json";
export const MAX_SECONDARY_DEVIATION_RATIO = 0.25;
export const MAX_PENDING_AGE_MS = 60 * 60 * 1000;
export const MIN_QUOTE_COUNT = 30;
export const MIN_VENDOR_COUNT = 12;
export const MAX_INDEX_HISTORY_DAYS = 90;

const PRICING_UNIT = "per_million_tokens";
const FORBIDDEN_AGGREGATE_KEYS = new Set([
  "average",
  "averagePrice",
  "mean",
  "meanPrice",
  "medianPrice",
  "compositePrice",
  "p25",
  "p50",
  "p75",
]);

export class ModelMarketError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ModelMarketError";
    this.code = code;
  }
}

function fail(code, message, options) {
  throw new ModelMarketError(code, message, options);
}

function rounded(value, digits = 8) {
  return Number(value.toFixed(digits));
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") fail("INVALID_REGISTRY", `${field} must be a non-empty string`);
  return value.trim();
}

function requiredPositive(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail("INVALID_PRICE", `${field} must be a finite number greater than zero`);
  }
  return value;
}

function nullablePositive(value, field) {
  if (value === null || value === undefined) return null;
  return requiredPositive(value, field);
}

function requiredHttpsUrl(value, field) {
  const text = requiredString(value, field);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    fail("INVALID_PROVENANCE", `${field} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:") fail("INVALID_PROVENANCE", `${field} must use HTTPS`);
  return text;
}

function samePrices(left, right) {
  return left?.currency === right?.currency
    && left?.input === right?.input
    && left?.cachedInput === right?.cachedInput
    && left?.output === right?.output;
}

function normalizeRegistry(registry) {
  if (!Array.isArray(registry) || registry.length === 0) fail("EMPTY_REGISTRY", "modelRegistry must be a non-empty array");
  const ids = new Set();
  return registry.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("INVALID_REGISTRY", `modelRegistry[${index}] must be an object`);
    const id = requiredString(raw.id, `modelRegistry[${index}].id`);
    if (ids.has(id)) fail("DUPLICATE_MODEL", `Duplicate model id: ${id}`);
    ids.add(id);
    const currency = requiredString(raw.originalCurrency, `${id}.originalCurrency`).toUpperCase();
    if (currency !== "USD" && currency !== "CNY") fail("UNSUPPORTED_CURRENCY", `${id} uses unsupported currency ${currency}`);
    if (!Array.isArray(raw.litellmCandidates)) fail("INVALID_REGISTRY", `${id}.litellmCandidates must be an array`);
    const candidates = raw.litellmCandidates.map((value, candidateIndex) => requiredString(value, `${id}.litellmCandidates[${candidateIndex}]`));
    const hasInput = raw.inputPerMillion !== null && raw.inputPerMillion !== undefined;
    const hasOutput = raw.outputPerMillion !== null && raw.outputPerMillion !== undefined;
    if (hasInput !== hasOutput) fail("INVALID_PRICE", `${id} must provide both input and output prices or neither`);
    if (!hasInput && raw.indexMember === true) fail("INVALID_INDEX_MEMBER", `${id} cannot join the index without a reviewed price`);
    return Object.freeze({
      ...raw,
      id,
      vendor: requiredString(raw.vendor, `${id}.vendor`),
      model: requiredString(raw.model, `${id}.model`),
      market: requiredString(raw.market, `${id}.market`),
      categories: Array.isArray(raw.categories) ? [...raw.categories] : [],
      originalCurrency: currency,
      inputPerMillion: hasInput ? requiredPositive(raw.inputPerMillion, `${id}.inputPerMillion`) : null,
      cachedInputPerMillion: hasInput ? nullablePositive(raw.cachedInputPerMillion, `${id}.cachedInputPerMillion`) : null,
      outputPerMillion: hasOutput ? requiredPositive(raw.outputPerMillion, `${id}.outputPerMillion`) : null,
      officialSourceName: requiredString(raw.officialSourceName, `${id}.officialSourceName`),
      officialSourceUrl: requiredString(raw.officialSourceUrl, `${id}.officialSourceUrl`),
      sourceGrade: requiredString(raw.sourceGrade, `${id}.sourceGrade`),
      serviceTier: requiredString(raw.serviceTier, `${id}.serviceTier`),
      contextBand: requiredString(raw.contextBand, `${id}.contextBand`),
      availabilityNote: typeof raw.availabilityNote === "string" ? raw.availabilityNote : "",
      litellmCandidates: candidates,
      indexMember: raw.indexMember === true,
      hasReviewedPrice: hasInput && hasOutput,
    });
  });
}

export function parseEcbUsdCny(xml) {
  if (typeof xml !== "string" || xml.length === 0) fail("INVALID_ECB_FX", "ECB response was empty");
  const rate = (currency) => {
    const cube = (xml.match(/<Cube\b[^>]*>/gi) ?? []).find((tag) => (
      new RegExp(`\\bcurrency=["']${currency}["']`, "i").test(tag)
    ));
    const match = cube?.match(/\brate=["']([0-9.]+)["']/i);
    const parsed = match ? Number(match[1]) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) fail("INVALID_ECB_FX", `ECB response did not contain a valid ${currency} rate`);
    return parsed;
  };
  const usdPerEur = rate("USD");
  const cnyPerEur = rate("CNY");
  return rounded(cnyPerEur / usdPerEur);
}

function parseLiteLlmCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_LITELLM_CATALOG", "LiteLLM catalog root must be an object");
  return value;
}

function liteLlmPrices(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const perMillion = (value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    return value * 1_000_000;
  };
  const input = perMillion(row.input_cost_per_token);
  const output = perMillion(row.output_cost_per_token);
  if (input === null || output === null) return null;
  return {
    currency: "USD",
    input,
    cachedInput: perMillion(row.cache_read_input_token_cost),
    output,
  };
}

function convertUsdPrices(prices, targetCurrency, usdCny) {
  const factor = targetCurrency === "CNY" ? usdCny : 1;
  return {
    currency: targetCurrency,
    input: rounded(prices.input * factor),
    cachedInput: prices.cachedInput === null ? null : rounded(prices.cachedInput * factor),
    output: rounded(prices.output * factor),
  };
}

function officialPrices(entry) {
  return {
    currency: entry.originalCurrency,
    input: entry.inputPerMillion,
    cachedInput: entry.cachedInputPerMillion,
    output: entry.outputPerMillion,
  };
}

function withinThreshold(candidate, baseline, threshold) {
  for (const field of ["input", "output"]) {
    const ratio = Math.abs(candidate[field] - baseline[field]) / baseline[field];
    if (!Number.isFinite(ratio) || ratio > threshold) return false;
  }
  if (candidate.cachedInput !== null && baseline.cachedInput !== null) {
    const ratio = Math.abs(candidate.cachedInput - baseline.cachedInput) / baseline.cachedInput;
    if (!Number.isFinite(ratio) || ratio > threshold) return false;
  }
  return true;
}

function priorAcceptedPrices(previousSnapshot, entry, baseline, threshold) {
  const previous = previousSnapshot?.quotes?.find?.((quote) => quote.id === entry.id);
  const candidate = previous?.prices?.original;
  if (!candidate || candidate.currency !== baseline.currency) return baseline;
  try {
    const normalized = {
      currency: candidate.currency,
      input: requiredPositive(candidate.input, `${entry.id}.previous.input`),
      cachedInput: baseline.cachedInput === null
        ? null
        : (nullablePositive(candidate.cachedInput, `${entry.id}.previous.cachedInput`) ?? baseline.cachedInput),
      output: requiredPositive(candidate.output, `${entry.id}.previous.output`),
    };
    return withinThreshold(normalized, baseline, threshold) ? normalized : baseline;
  } catch {
    return baseline;
  }
}

function normalizedCny(prices, usdCny) {
  const factor = prices.currency === "USD" ? usdCny : 1;
  return {
    input: rounded(prices.input * factor),
    cachedInput: prices.cachedInput === null ? null : rounded(prices.cachedInput * factor),
    output: rounded(prices.output * factor),
  };
}

function failureSummary(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "FETCH_FAILED",
    message: error instanceof Error ? error.message : "Source fetch failed",
  };
}

async function sourceResult(collect) {
  try {
    return { ok: true, value: await collect(), failure: null };
  } catch (error) {
    return { ok: false, value: null, failure: failureSummary(error) };
  }
}

function assertCompleteQuoteSet(quotes, expectedCount) {
  if (!Array.isArray(quotes) || quotes.length !== expectedCount) {
    fail("PARTIAL_TABLE", `Expected ${expectedCount} model quotes, received ${quotes?.length ?? 0}`);
  }
  const ids = new Set();
  for (const quote of quotes) {
    if (ids.has(quote.id)) fail("DUPLICATE_MODEL", `Duplicate quote id: ${quote.id}`);
    ids.add(quote.id);
    if (quote.hasReviewedPrice === false) {
      if (quote.indexMember !== false || quote.sourceStatus !== "official_page" || quote.isStale !== true) {
        fail("INVALID_UNPRICED_MODEL", `${quote.id} has an invalid unpriced-model state`);
      }
      const values = [
        quote.inputPerMillion,
        quote.cachedInputPerMillion,
        quote.outputPerMillion,
        quote.inputCnyPerMillion,
        quote.cachedInputCnyPerMillion,
        quote.outputCnyPerMillion,
        quote.originalInputPerMillion,
        quote.originalCachedInputPerMillion,
        quote.originalOutputPerMillion,
        quote.prices?.original?.input,
        quote.prices?.original?.cachedInput,
        quote.prices?.original?.output,
        quote.prices?.cny?.input,
        quote.prices?.cny?.cachedInput,
        quote.prices?.cny?.output,
      ];
      if (values.some((value) => value !== null)) fail("INVALID_UNPRICED_MODEL", `${quote.id} must use null for every unavailable price`);
      continue;
    }
    for (const [key, value] of Object.entries(quote.prices.original)) {
      if (key === "currency" || value === null) continue;
      requiredPositive(value, `${quote.id}.prices.original.${key}`);
    }
    for (const [key, value] of Object.entries(quote.prices.cny)) {
      if (value === null) continue;
      requiredPositive(value, `${quote.id}.prices.cny.${key}`);
    }
  }
}

export async function buildPendingSnapshot(options) {
  const now = options.now ? new Date(options.now) : new Date();
  if (!Number.isFinite(now.getTime())) fail("INVALID_TIME", "now must be a valid date");
  const reviewedRegistry = normalizeRegistry(options.modelRegistry);
  const pricedRegistry = reviewedRegistry.filter((entry) => entry.hasReviewedPrice);
  const unpricedModels = reviewedRegistry.filter((entry) => !entry.hasReviewedPrice).map((entry) => ({
    id: entry.id,
    vendor: entry.vendor,
    model: entry.model,
    market: entry.market,
    categories: entry.categories,
    sourceName: entry.officialSourceName,
    sourceUrl: entry.officialSourceUrl,
    sourceStatus: "official_page",
    availabilityNote: entry.availabilityNote,
    state: "review_required",
    reason: "NO_REVIEWED_PUBLIC_PRICE",
  }));
  if (pricedRegistry.length === 0) fail("EMPTY_PRICED_REGISTRY", "The reviewed registry contains no publishable prices");
  const fetchOptions = {
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
    attempts: options.attempts,
    timeoutMs: options.timeoutMs,
    baseDelayMs: options.baseDelayMs,
  };

  const [ecbResult, liteLlmResult] = await Promise.all([
    sourceResult(async () => parseEcbUsdCny((await fetchTextWithRetry(options.ecbUrl ?? ECB_DAILY_FX_URL, {
      ...fetchOptions,
      accept: "application/xml,text/xml",
    })).text)),
    sourceResult(async () => parseLiteLlmCatalog((await fetchJsonWithRetry(options.litellmUrl ?? LITELLM_CATALOG_URL, fetchOptions)).value)),
  ]);

  const previousFx = Number(options.previousSnapshot?.exchangeRate?.usdCny);
  const fallbackFx = Number(options.usdCnyFallback);
  const usdCny = ecbResult.ok
    ? ecbResult.value
    : (Number.isFinite(previousFx) && previousFx > 0 ? previousFx : fallbackFx);
  if (!Number.isFinite(usdCny) || usdCny <= 0) {
    fail("FX_UNAVAILABLE", "ECB failed and no valid previous or fallback USD/CNY rate is available");
  }

  const threshold = options.maxSecondaryDeviationRatio ?? MAX_SECONDARY_DEVIATION_RATIO;
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    fail("INVALID_THRESHOLD", "maxSecondaryDeviationRatio must be between 0 and 1");
  }
  const generatedAt = now.toISOString();
  const quotes = reviewedRegistry.map((entry) => {
    if (!entry.hasReviewedPrice) {
      const unavailable = { currency: entry.originalCurrency, input: null, cachedInput: null, output: null };
      return {
        ...entry,
        pricingUnit: PRICING_UNIT,
        aggregationScope: "single_model",
        prices: { original: unavailable, cny: { input: null, cachedInput: null, output: null } },
        inputCnyPerMillion: null,
        cachedInputCnyPerMillion: null,
        outputCnyPerMillion: null,
        originalInputPerMillion: null,
        originalCachedInputPerMillion: null,
        originalOutputPerMillion: null,
        sourceName: entry.officialSourceName,
        sourceUrl: entry.officialSourceUrl,
        sourceStatus: "official_page",
        updatedAt: generatedAt,
        isStale: true,
        availabilityNote: `官方未提供稳定公开现付价，待人工审核。${entry.availabilityNote}`,
        freshness: { state: "review_required", reason: "NO_REVIEWED_PUBLIC_PRICE", checkedAt: generatedAt },
        secondarySource: null,
      };
    }
    const baseline = officialPrices(entry);
    const previousQuote = options.previousSnapshot?.quotes?.find((quote) => quote.id === entry.id);
    const retained = previousQuote?.sourceStatus === "aggregated"
      ? priorAcceptedPrices(options.previousSnapshot, entry, baseline, threshold)
      : baseline;
    let selected = retained;
    let freshness;
    let selectedFromAggregate = previousQuote?.sourceStatus === "aggregated"
      && !samePrices(retained, baseline);
    let secondarySource = selectedFromAggregate ? previousQuote.secondarySource : null;

    if (entry.litellmCandidates.length === 0) {
      freshness = { state: "official_only", reason: "NO_SECONDARY_MAPPING", checkedAt: generatedAt };
    } else if (!liteLlmResult.ok) {
      freshness = { state: "stale", reason: liteLlmResult.failure.code, checkedAt: generatedAt };
    } else {
      const exactMatches = entry.litellmCandidates
        .filter((candidate) => Object.hasOwn(liteLlmResult.value, candidate))
        .map((exactKey) => ({ exactKey, prices: liteLlmPrices(liteLlmResult.value[exactKey]) }))
        .filter((match) => match.prices !== null)
        .map((match) => {
          const converted = convertUsdPrices(match.prices, entry.originalCurrency, usdCny);
          return {
            ...match,
            converted: {
              ...converted,
              cachedInput: baseline.cachedInput === null
                ? null
                : (converted.cachedInput ?? baseline.cachedInput),
            },
          };
        });
      const safeMatch = exactMatches.find((match) => withinThreshold(match.converted, baseline, threshold));
      if (exactMatches.length === 0) {
        freshness = { state: "stale", reason: "SECONDARY_MODEL_NOT_FOUND", checkedAt: generatedAt };
      } else if (safeMatch) {
        selected = safeMatch.converted;
        selectedFromAggregate = true;
        secondarySource = { catalog: "LiteLLM", exactKey: safeMatch.exactKey, sourceUrl: options.litellmUrl ?? LITELLM_CATALOG_URL };
        freshness = { state: "current", reason: "EXACT_MATCH_WITHIN_THRESHOLD", checkedAt: generatedAt };
      } else {
        secondarySource = { catalog: "LiteLLM", exactKey: exactMatches[0].exactKey, sourceUrl: options.litellmUrl ?? LITELLM_CATALOG_URL };
        freshness = { state: "review_required", reason: "SECONDARY_PRICE_OUTSIDE_THRESHOLD", checkedAt: generatedAt };
      }
    }

    const cnyPrices = normalizedCny(selected, usdCny);
    const sourceStatus = selectedFromAggregate ? "aggregated" : "official_page";
    const sourceName = sourceStatus === "aggregated"
      ? "LiteLLM 聚合目录（官方页面待复核）"
      : entry.officialSourceName;
    const sourceUrl = sourceStatus === "aggregated"
      ? secondarySource.sourceUrl
      : entry.officialSourceUrl;
    return {
      ...entry,
      pricingUnit: PRICING_UNIT,
      aggregationScope: "single_model",
      prices: {
        original: selected,
        cny: cnyPrices,
      },
      inputCnyPerMillion: cnyPrices.input,
      cachedInputCnyPerMillion: cnyPrices.cachedInput,
      outputCnyPerMillion: cnyPrices.output,
      originalInputPerMillion: selected.input,
      originalCachedInputPerMillion: selected.cachedInput,
      originalOutputPerMillion: selected.output,
      sourceName,
      sourceUrl,
      sourceStatus,
      updatedAt: generatedAt,
      isStale: freshness.state === "stale" || freshness.state === "review_required",
      freshness,
      secondarySource,
    };
  });
  assertCompleteQuoteSet(quotes, reviewedRegistry.length);

  const pending = {
    schemaVersion: PENDING_SCHEMA,
    generatedAt,
    validForMinutes: 60,
    marketDefinition: {
      kind: "per_model_quotes",
      pricingUnit: PRICING_UNIT,
      aggregatePublication: "fixed_basket_index_only",
      disclaimer: "不同模型价格不可直接求均价；综合指标仅为固定篮子趋势指数。",
    },
    exchangeRate: {
      usdCny,
      source: ecbResult.ok ? "ECB_DAILY_REFERENCE" : "RETAINED_OR_REVIEWED_FALLBACK",
      state: ecbResult.ok ? "current" : "stale",
      sourceUrl: options.ecbUrl ?? ECB_DAILY_FX_URL,
      failure: ecbResult.failure,
    },
    sources: {
      officialRegistry: {
        state: "reviewed",
        registeredModelCount: reviewedRegistry.length,
        registeredIds: reviewedRegistry.map((entry) => entry.id).sort(),
        quoteCount: quotes.length,
        pricedQuoteCount: pricedRegistry.length,
        unpricedModelCount: unpricedModels.length,
      },
      ecb: { state: ecbResult.ok ? "current" : "stale", failure: ecbResult.failure },
      litellm: { state: liteLlmResult.ok ? "current" : "stale", failure: liteLlmResult.failure },
    },
    quotes,
    unpricedModels,
    indexCandidateIds: reviewedRegistry.filter((entry) => entry.indexMember).map((entry) => entry.id),
    validation: {
      quoteCount: quotes.length,
      pricedQuoteCount: pricedRegistry.length,
      registeredModelCount: reviewedRegistry.length,
      unpricedModelCount: unpricedModels.length,
      vendorCount: new Set(quotes.map((quote) => quote.vendor)).size,
      completeTable: true,
      containsCrossModelAverage: false,
      noZeroOrNegativePrices: true,
    },
  };
  return pending;
}

async function readJsonIfPresent(path) {
  if (!path) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail("INVALID_JSON_FILE", `Could not read ${path}`, { cause: error });
  }
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } catch (error) {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(temporaryPath);
    } catch {}
    throw error;
  }
}

export async function stageModelMarket(options) {
  const previousSnapshot = options.previousSnapshot ?? await readJsonIfPresent(options.snapshotPath);
  const pending = await buildPendingSnapshot({ ...options, previousSnapshot });
  await writeJsonAtomic(options.pendingPath, pending);
  return pending;
}

function rejectCrossModelAverage(value, path = "pending") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    const aggregateKey = FORBIDDEN_AGGREGATE_KEYS.has(key)
      || /^(?:avg|average|mean|median|p25|p50|p75|composite)(?:price|cost|cny|permillion|cnypermillion)?$/i.test(key);
    if (aggregateKey) fail("CROSS_MODEL_AVERAGE", `${path}.${key} is not permitted`);
    rejectCrossModelAverage(nested, `${path}.${key}`);
  }
}

function validatePromotablePending(pending, now, expectedRegistryIds) {
  if (!pending || typeof pending !== "object" || pending.schemaVersion !== PENDING_SCHEMA) {
    fail("INVALID_PENDING", "Pending snapshot schema is invalid");
  }
  const generatedAt = Date.parse(pending.generatedAt);
  const age = now.getTime() - generatedAt;
  if (!Number.isFinite(generatedAt) || age < -5 * 60 * 1000 || age > MAX_PENDING_AGE_MS) {
    fail("STALE_PENDING", "Pending snapshot must be generated within the last 60 minutes");
  }
  if (pending.exchangeRate?.state !== "current"
    || pending.sources?.ecb?.state !== "current"
    || pending.sources?.litellm?.state !== "current") {
    fail("SOURCE_UNAVAILABLE", "Daily publication requires current ECB and model-catalog source checks");
  }
  if (pending.marketDefinition?.kind !== "per_model_quotes" || pending.marketDefinition?.aggregatePublication !== "fixed_basket_index_only") {
    fail("CROSS_MODEL_AVERAGE", "Pending snapshot must publish per-model quotes and a fixed-basket index only");
  }
  rejectCrossModelAverage(pending);
  const quotes = pending.quotes;
  if (!Array.isArray(quotes) || quotes.length < MIN_QUOTE_COUNT) {
    fail("INSUFFICIENT_QUOTES", `At least ${MIN_QUOTE_COUNT} complete model quotes are required`);
  }
  const registeredIds = pending.sources?.officialRegistry?.registeredIds;
  const registeredModelCount = pending.sources?.officialRegistry?.registeredModelCount;
  if (!Array.isArray(registeredIds)
    || !Number.isInteger(registeredModelCount)
    || registeredModelCount !== registeredIds.length
    || new Set(registeredIds).size !== registeredIds.length
    || registeredIds.some((id) => typeof id !== "string" || id.length === 0)) {
    fail("INVALID_REGISTRY_CONTRACT", "Pending snapshot must contain one unique registered id for every reviewed registry row");
  }
  if (expectedRegistryIds !== undefined) {
    if (!Array.isArray(expectedRegistryIds)
      || new Set(expectedRegistryIds).size !== expectedRegistryIds.length
      || expectedRegistryIds.some((id) => typeof id !== "string" || id.length === 0)) {
      fail("INVALID_REGISTRY_CONTRACT", "The trusted registry id contract is invalid");
    }
    const trustedIds = [...expectedRegistryIds].sort();
    const stagedIds = [...registeredIds].sort();
    if (trustedIds.length !== stagedIds.length || trustedIds.some((id, index) => id !== stagedIds[index])) {
      fail("REGISTRY_CONTRACT_MISMATCH", "Pending registry ids differ from the trusted production registry");
    }
  }
  if (quotes.length !== registeredModelCount) {
    fail("PARTIAL_TABLE", `Expected all ${registeredModelCount} registered quotes, received ${quotes.length}`);
  }
  const registeredIdSet = new Set(registeredIds);
  const vendors = new Set();
  const ids = new Set();
  let pricedQuoteCount = 0;
  let unpricedModelCount = 0;
  requiredPositive(pending.exchangeRate?.usdCny, "exchangeRate.usdCny");
  for (const quote of quotes) {
    if (!quote || quote.aggregationScope !== "single_model" || quote.pricingUnit !== PRICING_UNIT) {
      fail("INVALID_QUOTE_SCOPE", "Every quote must be scoped to one model and one pricing unit");
    }
    const quoteId = requiredString(quote.id, "quote.id");
    if (ids.has(quoteId)) fail("DUPLICATE_MODEL", `Duplicate quote id: ${quoteId}`);
    if (!registeredIdSet.has(quoteId)) fail("REGISTRY_ID_MISMATCH", `Unregistered quote id: ${quoteId}`);
    ids.add(quoteId);
    vendors.add(requiredString(quote.vendor, `${quote.id}.vendor`));
    const sourceStatus = requiredString(quote.sourceStatus, `${quote.id}.sourceStatus`);
    if (sourceStatus !== "official_page" && sourceStatus !== "aggregated") {
      fail("INVALID_PROVENANCE", `${quote.id}.sourceStatus is not publishable`);
    }
    const sourceName = requiredString(quote.sourceName, `${quote.id}.sourceName`);
    const sourceUrl = requiredHttpsUrl(quote.sourceUrl, `${quote.id}.sourceUrl`);
    const officialSourceName = requiredString(quote.officialSourceName, `${quote.id}.officialSourceName`);
    const officialSourceUrl = requiredHttpsUrl(quote.officialSourceUrl, `${quote.id}.officialSourceUrl`);
    const freshnessState = requiredString(quote.freshness?.state, `${quote.id}.freshness.state`);
    if (!new Set(["current", "official_only", "stale", "review_required"]).has(freshnessState)) {
      fail("INVALID_PROVENANCE", `${quote.id}.freshness.state is invalid`);
    }
    if (!Number.isFinite(Date.parse(quote.updatedAt)) || !Number.isFinite(Date.parse(quote.freshness?.checkedAt))) {
      fail("INVALID_PROVENANCE", `${quote.id} must include valid source-check timestamps`);
    }
    const expectedStale = freshnessState === "stale" || freshnessState === "review_required";
    if (quote.isStale !== expectedStale) fail("INVALID_PROVENANCE", `${quote.id}.isStale conflicts with freshness.state`);
    if (sourceStatus === "aggregated") {
      if (quote.secondarySource?.catalog !== "LiteLLM"
        || requiredString(quote.secondarySource?.exactKey, `${quote.id}.secondarySource.exactKey`).length === 0
        || requiredHttpsUrl(quote.secondarySource?.sourceUrl, `${quote.id}.secondarySource.sourceUrl`) !== sourceUrl
        || !/LiteLLM/i.test(sourceName)) {
        fail("INVALID_PROVENANCE", `${quote.id} aggregated prices must identify the exact LiteLLM source`);
      }
    } else if (sourceName !== officialSourceName || sourceUrl !== officialSourceUrl) {
      fail("INVALID_PROVENANCE", `${quote.id} official prices must link to the reviewed official source`);
    }
    if (quote.hasReviewedPrice === false) {
      const unavailableValues = [
        quote.inputPerMillion,
        quote.cachedInputPerMillion,
        quote.outputPerMillion,
        quote.originalInputPerMillion,
        quote.originalCachedInputPerMillion,
        quote.originalOutputPerMillion,
        quote.inputCnyPerMillion,
        quote.cachedInputCnyPerMillion,
        quote.outputCnyPerMillion,
        quote.prices?.original?.input,
        quote.prices?.original?.cachedInput,
        quote.prices?.original?.output,
        quote.prices?.cny?.input,
        quote.prices?.cny?.cachedInput,
        quote.prices?.cny?.output,
      ];
      if (quote.indexMember !== false
        || quote.sourceStatus !== "official_page"
        || quote.isStale !== true
        || unavailableValues.some((value) => value !== null)) {
        fail("INVALID_UNPRICED_MODEL", `${quote.id} must be a stale, non-indexed, null-priced official row`);
      }
      unpricedModelCount += 1;
      continue;
    }
    if (freshnessState === "review_required") {
      fail("REVIEW_REQUIRED", `${quote.id} has a priced source discrepancy that requires review`);
    }
    pricedQuoteCount += 1;
    if (quote.prices?.original?.currency !== quote.originalCurrency
      || quote.prices.original.input !== quote.originalInputPerMillion
      || quote.prices.original.cachedInput !== quote.originalCachedInputPerMillion
      || quote.prices.original.output !== quote.originalOutputPerMillion
      || quote.prices?.cny?.input !== quote.inputCnyPerMillion
      || quote.prices.cny.cachedInput !== quote.cachedInputCnyPerMillion
      || quote.prices.cny.output !== quote.outputCnyPerMillion) {
      fail("INVALID_PRICE_CONTRACT", `${quote.id} flattened and normalized prices disagree`);
    }
    if (sourceStatus === "official_page"
      && (quote.originalInputPerMillion !== quote.inputPerMillion
        || quote.originalCachedInputPerMillion !== quote.cachedInputPerMillion
        || quote.originalOutputPerMillion !== quote.outputPerMillion)) {
      fail("INVALID_PROVENANCE", `${quote.id} official values differ from the reviewed registry baseline`);
    }
    if (sourceStatus === "aggregated") {
      for (const [actual, reviewed] of [
        [quote.originalInputPerMillion, quote.inputPerMillion],
        [quote.originalOutputPerMillion, quote.outputPerMillion],
      ]) {
        if (Math.abs(actual - reviewed) / reviewed > MAX_SECONDARY_DEVIATION_RATIO) {
          fail("INVALID_PROVENANCE", `${quote.id} aggregated value exceeds the reviewed deviation threshold`);
        }
      }
    }
    for (const field of ["input", "output"]) requiredPositive(quote.prices?.original?.[field], `${quote.id}.prices.original.${field}`);
    nullablePositive(quote.prices?.original?.cachedInput, `${quote.id}.prices.original.cachedInput`);
    for (const field of ["input", "output"]) requiredPositive(quote.prices?.cny?.[field], `${quote.id}.prices.cny.${field}`);
    nullablePositive(quote.prices?.cny?.cachedInput, `${quote.id}.prices.cny.cachedInput`);
    for (const field of ["inputPerMillion", "outputPerMillion", "originalInputPerMillion", "originalOutputPerMillion", "inputCnyPerMillion", "outputCnyPerMillion"]) {
      requiredPositive(quote[field], `${quote.id}.${field}`);
    }
    for (const field of ["cachedInputPerMillion", "originalCachedInputPerMillion", "cachedInputCnyPerMillion"]) {
      nullablePositive(quote[field], `${quote.id}.${field}`);
    }
  }
  if (ids.size !== registeredIdSet.size || registeredIds.some((id) => !ids.has(id))) {
    fail("PARTIAL_TABLE", "Pending quote ids do not exactly match the reviewed registry contract");
  }
  if (vendors.size < MIN_VENDOR_COUNT) fail("INSUFFICIENT_VENDORS", `At least ${MIN_VENDOR_COUNT} vendors are required`);
  if (pricedQuoteCount < MIN_QUOTE_COUNT) fail("INSUFFICIENT_PRICED_QUOTES", `At least ${MIN_QUOTE_COUNT} priced model quotes are required`);
  if (pending.validation?.completeTable !== true
    || pending.validation?.containsCrossModelAverage !== false
    || pending.validation?.quoteCount !== quotes.length
    || pending.validation?.registeredModelCount !== registeredModelCount
    || pending.validation?.pricedQuoteCount !== pricedQuoteCount
    || pending.validation?.unpricedModelCount !== unpricedModelCount
    || pending.validation?.vendorCount !== vendors.size
    || pending.validation?.noZeroOrNegativePrices !== true
    || pending.sources.officialRegistry.quoteCount !== quotes.length
    || pending.sources.officialRegistry.pricedQuoteCount !== pricedQuoteCount
    || pending.sources.officialRegistry.unpricedModelCount !== unpricedModelCount) {
    fail("INVALID_PENDING_VALIDATION", "Pending snapshot did not pass completeness and aggregation checks");
  }
  return quotes;
}

function beijingDate(instant) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function quoteReferenceCost(quote) {
  return quote.prices.cny.input * 0.5 + quote.prices.cny.output * 0.5;
}

function buildIndex(pending, previousSnapshot, now) {
  const quoteById = new Map(pending.quotes.map((quote) => [quote.id, quote]));
  let basket;
  let value;
  if (previousSnapshot?.index?.kind === "fixed_basket_index" && Array.isArray(previousSnapshot.index.basket)) {
    basket = previousSnapshot.index.basket.map((member) => ({ ...member }));
    if (basket.length === 0) fail("EMPTY_INDEX_BASKET", "The previous fixed index basket is empty");
    let weightedLogRatio = 0;
    for (const member of basket) {
      const quote = quoteById.get(member.id);
      if (!quote) fail("INCOMPLETE_INDEX_BASKET", `Fixed basket model ${member.id} is missing`);
      const baseCost = requiredPositive(member.baseReferenceCostCny, `${member.id}.baseReferenceCostCny`);
      const weight = requiredPositive(member.weight, `${member.id}.weight`);
      weightedLogRatio += weight * Math.log(quoteReferenceCost(quote) / baseCost);
    }
    value = 100 * Math.exp(weightedLogRatio);
  } else {
    const members = [...new Set(pending.indexCandidateIds)].map((id) => quoteById.get(id)).filter(Boolean);
    if (members.length === 0) fail("EMPTY_INDEX_BASKET", "At least one reviewed model must be selected for the fixed basket");
    const weight = 1 / members.length;
    basket = members.map((quote) => ({
      id: quote.id,
      vendor: quote.vendor,
      model: quote.model,
      weight,
      baseReferenceCostCny: quoteReferenceCost(quote),
    }));
    value = 100;
  }
  if (!Number.isFinite(value) || value <= 0) fail("INVALID_INDEX", "Fixed-basket index calculation failed");
  const date = beijingDate(now);
  const priorHistory = Array.isArray(previousSnapshot?.index?.history) ? previousSnapshot.index.history : [];
  const history = priorHistory
    .filter((point) => point?.date !== date && Number.isFinite(point?.value) && point.value > 0)
    .concat({ date, value: Number(value.toFixed(4)) })
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-MAX_INDEX_HISTORY_DAYS);
  const changeFrom = (offset) => {
    const reference = history[Math.max(0, history.length - 1 - offset)]?.value;
    return Number.isFinite(reference) && reference > 0
      ? Number((((value / reference) - 1) * 100).toFixed(4))
      : 0;
  };
  const baseDate = previousSnapshot?.index?.baseDate ?? history[0].date;
  return {
    name: "KAI 模型调用成本指数",
    kind: "fixed_basket_index",
    baseValue: 100,
    baseDate,
    unit: "index_points",
    isProcurementPrice: false,
    methodology: "固定模型篮子内，各模型输入/输出等权参考成本的几何价格指数；不计算跨模型人民币均价。",
    basket,
    current: Number(value.toFixed(4)),
    value: Number(value.toFixed(4)),
    updatedAt: now.toISOString(),
    change1d: changeFrom(1),
    change30d: changeFrom(30),
    sampleSize: basket.length,
    history,
  };
}

export function createPromotedSnapshot(pending, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  if (!Number.isFinite(now.getTime())) fail("INVALID_TIME", "now must be a valid date");
  validatePromotablePending(pending, now, options.expectedRegistryIds);
  return {
    schemaVersion: SNAPSHOT_SCHEMA,
    publishedAt: now.toISOString(),
    sourcePendingGeneratedAt: pending.generatedAt,
    marketDefinition: pending.marketDefinition,
    exchangeRate: pending.exchangeRate,
    sources: pending.sources,
    quotes: pending.quotes,
    index: buildIndex(pending, options.previousSnapshot, now),
  };
}

export async function promoteModelMarket(options) {
  const pending = options.pending ?? await readJsonIfPresent(options.pendingPath);
  if (!pending) fail("PENDING_NOT_FOUND", "No staged model-market snapshot was found");
  const previousSnapshot = options.previousSnapshot ?? await readJsonIfPresent(options.snapshotPath);
  const snapshot = createPromotedSnapshot(pending, {
    now: options.now,
    previousSnapshot,
    expectedRegistryIds: options.expectedRegistryIds,
  });
  await writeJsonAtomic(options.snapshotPath, snapshot);
  return snapshot;
}
