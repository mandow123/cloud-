import * as catalog from "./catalog.mjs";
import type {
  CatalogQuote,
  DealMode,
  NormalizeQuoteContext,
  NormalizedQuote,
  ParsedResourceQuery,
  PriceFormatOptions,
  PricingUnit,
  ResourceFilters,
  ResourceListing,
  ResourceQueryInput,
  ResourceSort,
} from "./types";

export function parseResourceQuery(input: ResourceQueryInput = {}): ParsedResourceQuery {
  return catalog.parseResourceQuery(input) as ParsedResourceQuery;
}

export function filterResources(
  resources: readonly ResourceListing[],
  filters: ResourceFilters = {},
): ResourceListing[] {
  return catalog.filterResources(resources, filters) as ResourceListing[];
}

export function sortResources(
  resources: readonly ResourceListing[],
  sort: ResourceSort = "featured",
): ResourceListing[] {
  return catalog.sortResources(resources, sort) as ResourceListing[];
}

export function filterAndSortResources(
  resources: readonly ResourceListing[],
  filters: ResourceFilters = {},
): ResourceListing[] {
  return catalog.filterAndSortResources(resources, filters) as ResourceListing[];
}

export function formatPrice(
  value: number,
  pricingUnit: PricingUnit,
  options: PriceFormatOptions = {},
): string {
  return catalog.formatPrice(value, pricingUnit, options);
}

export function normalizeQuote(
  listingOrQuote: ResourceListing | CatalogQuote,
  context: NormalizeQuoteContext = {},
): NormalizedQuote {
  return catalog.normalizeQuote(listingOrQuote, context) as NormalizedQuote;
}

export function createDemoRequestId(
  kind: DealMode,
  seed: unknown = "kai-cloud-demo",
): string {
  return catalog.createDemoRequestId(kind, seed);
}

