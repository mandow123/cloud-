export const RESOURCE_CATEGORY_VALUES = [
  "gpu",
  "token_model",
  "rack_capacity",
  "cloud_vendor",
] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORY_VALUES)[number];

export const DEAL_MODE_VALUES = ["rental", "service", "swap"] as const;
export type DealMode = (typeof DEAL_MODE_VALUES)[number];

export const PRICING_UNIT_VALUES = [
  "卡时",
  "服务器时",
  "百万 Token",
  "模型实例时",
  "预留容量时",
  "机柜月",
  "kW 月",
] as const;
export type PricingUnit = (typeof PRICING_UNIT_VALUES)[number];

export const REGION_VALUES = [
  "北京",
  "上海",
  "广东",
  "浙江",
  "四川",
  "内蒙古",
  "全国",
  "海外",
] as const;
export type RegionName = (typeof REGION_VALUES)[number];

export const DELIVERY_FORM_VALUES = [
  "裸金属",
  "容器实例",
  "API 服务",
  "专属集群",
  "整机柜",
  "云主机",
] as const;
export type DeliveryForm = (typeof DELIVERY_FORM_VALUES)[number];

export type ResourceSort =
  | "featured"
  | "price_asc"
  | "price_desc"
  | "updated_desc"
  | "sample_desc";

export type MemberRole = "demand" | "supply";
export type RequestStatus = "submitted" | "reviewing" | "matched" | "quoted";

export interface Region {
  id: string;
  name: RegionName;
  hub: string;
  latencyNote: string;
}

export interface Supplier {
  id: string;
  name: string;
  shortName: string;
  description: string;
  categoryFocus: readonly ResourceCategory[];
}

export interface ServiceAlias {
  slug: string;
  label: string;
  description: string;
  category: ResourceCategory;
  dealMode: DealMode;
  pricingUnit: PricingUnit;
  keywords: readonly string[];
}

export interface CatalogQuote {
  currency: "CNY";
  pricingUnit: PricingUnit;
  rangeMin: number;
  rangeMax: number;
  median: number;
  taxIncluded: boolean;
  energyIncluded: boolean;
  networkIncluded: boolean;
  scopeNote: string;
  sampleCount: number;
  validUntil: string;
  updatedAt: string;
  disclaimer: string;
}

export interface ResourceSource {
  kind: "USER_PROVIDED_WORKBOOK_REFERENCE";
  supplierName: string;
  documentTitle: string;
  observedAt: string;
  verificationStatus: "UNVERIFIED";
  notice: string;
  note: string;
  originalCurrency: "CNY";
  publicConversionRate: string;
}

export interface ResourceListing {
  id: string;
  title: string;
  category: ResourceCategory;
  dealModes: readonly DealMode[];
  pricingUnit: PricingUnit;
  region: RegionName;
  supplierId: string;
  supplierName: string;
  deliveryForm: DeliveryForm;
  summary: string;
  specs: Readonly<Record<string, string>>;
  capacity: string;
  sla: string;
  deliveryLeadTime: string;
  tags: readonly string[];
  featured: boolean;
  quote: CatalogQuote;
  source?: ResourceSource;
}

export interface MarketPoint {
  date: string;
  p25: number;
  p50: number;
  p75: number;
  sampleCount: number;
}

export interface MarketSeries {
  id: string;
  category: ResourceCategory;
  label: string;
  pricingUnit: PricingUnit;
  region: string;
  points: readonly MarketPoint[];
  updatedAt: string;
  disclaimer: string;
}

export interface MarketSnapshot {
  id: string;
  category: ResourceCategory;
  label: string;
  pricingUnit: PricingUnit;
  region: string;
  p25: number;
  p50: number;
  p75: number;
  sampleCount: number;
  change7d: number;
  change30d: number;
  updatedAt: string;
  disclaimer: string;
}

export interface ResourceFilters {
  category?: ResourceCategory;
  dealMode?: DealMode;
  region?: RegionName;
  deliveryForm?: DeliveryForm;
  pricingUnit?: PricingUnit;
  q?: string;
  sort?: ResourceSort;
}

export interface ParsedResourceQuery extends ResourceFilters {
  sort: ResourceSort;
}

export interface PriceFormatOptions {
  compact?: boolean;
  withCurrency?: boolean;
}

export interface NormalizeQuoteContext {
  sourceListingId?: string | null;
  supplierId?: string | null;
  supplierName?: string;
  title?: string;
}

export interface NormalizedQuote {
  sourceListingId: string | null;
  supplierId: string | null;
  supplierName: string;
  title: string;
  currency: "CNY";
  pricingUnit: PricingUnit;
  normalizedRangeMin: number;
  normalizedRangeMax: number;
  normalizedMedian: number;
  displayRange: string;
  displayMedian: string;
  taxIncluded: boolean;
  energyIncluded: boolean;
  networkIncluded: boolean;
  scopeNote: string;
  sampleCount: number;
  validUntil: string;
  updatedAt: string;
  normalizedAt: string;
  methodology: string;
  disclaimer: string;
}

export interface RentalRequest {
  id: string;
  requestType: "rental";
  dealMode: "rental" | "service";
  listingId?: string;
  category: ResourceCategory;
  pricingUnit: PricingUnit;
  quantity: number;
  durationHours: number;
  region: RegionName;
  expectedStartDate: string;
  companyName: string;
  contactName: string;
  contactMethod: string;
  notes?: string;
  status: RequestStatus;
  createdAt: string;
}

export interface SwapResourceRequirement {
  category: ResourceCategory;
  description: string;
  pricingUnit: PricingUnit;
  quantity: number;
  region: RegionName;
}

export interface SwapRequest {
  id: string;
  requestType: "swap";
  offer: SwapResourceRequirement;
  need: SwapResourceRequirement;
  cashAdjustmentAllowed: boolean;
  cashAdjustmentLimit?: number;
  companyName: string;
  contactName: string;
  contactMethod: string;
  notes?: string;
  status: RequestStatus;
  createdAt: string;
}

export type ResourceQueryInput =
  | URLSearchParams
  | string
  | Record<string, string | string[] | undefined>;
