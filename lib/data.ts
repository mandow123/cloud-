import * as catalog from "./catalog.mjs";
import type {
  MarketSeries,
  MarketSnapshot,
  NormalizedQuote,
  Region,
  RentalRequest,
  ResourceCategory,
  ResourceListing,
  ServiceAlias,
  Supplier,
  SwapRequest,
} from "./types";

export const MARKET_REFERENCE_NOTICE: string = catalog.MARKET_REFERENCE_NOTICE;
export const RESOURCE_CATEGORIES = catalog.RESOURCE_CATEGORIES as readonly ResourceCategory[];
export const DEAL_MODES = catalog.DEAL_MODES;
export const PRICING_UNITS = catalog.PRICING_UNITS;
export const DELIVERY_FORMS = catalog.DELIVERY_FORMS;
export const RESOURCE_SORTS = catalog.RESOURCE_SORTS;
export const categoryLabels = catalog.categoryLabels as Readonly<Record<ResourceCategory, string>>;
export const dealModeLabels = catalog.dealModeLabels;

export const regions = catalog.regions as readonly Region[];
export const regionNames = catalog.regionNames;
export const suppliers = catalog.suppliers as readonly Supplier[];
export const serviceAliases = catalog.serviceAliases as readonly ServiceAlias[];
export const resourceListings = catalog.resourceListings as readonly ResourceListing[];
export const marketSeries = catalog.marketSeries as readonly MarketSeries[];
export const marketSnapshots = catalog.marketSnapshots as readonly MarketSnapshot[];
export const initializationRentalRequests = catalog.initializationRentalRequests as readonly RentalRequest[];
export const initializationSwapRequests = catalog.initializationSwapRequests as readonly SwapRequest[];
export const initializationNormalizedQuotes = catalog.initializationNormalizedQuotes as readonly NormalizedQuote[];

export function getResourceById(id: string): ResourceListing | undefined {
  return catalog.getResourceById(id) as ResourceListing | undefined;
}

export function findServiceAlias(input: string): ServiceAlias | undefined {
  return catalog.findServiceAlias(input) as ServiceAlias | undefined;
}

