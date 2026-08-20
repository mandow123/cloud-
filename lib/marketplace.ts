import type { DealMode, PricingUnit, ResourceCategory } from "@/lib/types";

export type { DealMode, PricingUnit, ResourceCategory } from "@/lib/types";

export const marketplaceCategories: ResourceCategory[] = [
  "gpu",
  "token_model",
  "rack_capacity",
  "cloud_vendor",
];

export const marketplacePricingUnits: PricingUnit[] = [
  "卡时",
  "服务器时",
  "百万 Token",
  "模型实例时",
  "预留容量时",
  "机柜月",
  "kW 月",
];

export const categoryPricingUnits: Record<ResourceCategory, PricingUnit[]> = {
  gpu: ["卡时", "服务器时", "预留容量时"],
  token_model: ["百万 Token", "模型实例时", "预留容量时"],
  rack_capacity: ["机柜月", "kW 月", "预留容量时"],
  cloud_vendor: ["卡时", "服务器时", "预留容量时"],
};

export const marketplaceRegions = ["北京", "上海", "广东", "浙江", "四川", "内蒙古", "全国"] as const;
export type MarketplaceRegion = (typeof marketplaceRegions)[number];

export const marketplaceQuoteLeadTimes = ["48 小时内", "7 天内", "30 天内", "排期交付"] as const;
export type MarketplaceQuoteLeadTime = (typeof marketplaceQuoteLeadTimes)[number];

export function isMarketplaceRegion(value: unknown): value is MarketplaceRegion {
  return typeof value === "string" && (marketplaceRegions as readonly string[]).includes(value);
}

export function isMarketplaceQuoteLeadTime(value: unknown): value is MarketplaceQuoteLeadTime {
  return typeof value === "string" && (marketplaceQuoteLeadTimes as readonly string[]).includes(value);
}

export type RequestStatus = "已记录" | "报价已收到" | "标准化中" | "方案待确认";

export type MarketplaceSwapLeg = {
  category: ResourceCategory;
  pricingUnit: PricingUnit;
  quantity: number;
  description: string;
};

export type MarketplaceRequestRecord = {
  id: string;
  requestType: "procurement" | "swap";
  kind: DealMode;
  title: string;
  category: ResourceCategory;
  region: MarketplaceRegion;
  pricingUnit: PricingUnit;
  quantity: number;
  durationHours: number | null;
  deliveryDate: string | null;
  summary: string;
  offered: MarketplaceSwapLeg | null;
  wanted: MarketplaceSwapLeg | null;
  cashDirection: "none" | "offer" | "request";
  cashAmount: number | null;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
};

export type MarketplaceSupplierQuoteRecord = {
  id: string;
  demandId: string;
  demandTitle: string;
  unitPrice: number;
  pricingUnit: PricingUnit;
  currency: "CNY";
  leadTime: MarketplaceQuoteLeadTime;
  validDays: number;
  validUntil: string;
  scopeNote: string;
  status: "已提交" | "已过期" | "需求已更新 · 需重新报价";
  createdAt: string;
};

export type MarketplaceNormalizedQuoteRecord = {
  id: string;
  demandId: string;
  demandTitle: string;
  standardizedUnitPrice: number;
  pricingUnit: PricingUnit;
  currency: "CNY";
  deliveryWindow: MarketplaceQuoteLeadTime;
  validUntil: string;
  standardizedScope: string;
  standardizationVersion: "kai-standard-v1";
  standardizationNote: string;
  status: "已标准化" | "已过期" | "需求已更新 · 需重新报价";
  createdAt: string;
};

export type MarketplaceDraftRecord = {
  id: string;
  title: string;
  category: ResourceCategory;
  capacity: string;
  status: "草稿";
  createdAt: string;
};

export type CreateProcurementRequest = {
  requestType: "procurement";
  dealMode: "rental" | "service";
  category: ResourceCategory;
  pricingUnit: PricingUnit;
  quantity: number;
  durationHours: number | null;
  region: MarketplaceRegion;
  deliveryDate: string;
  requirements: string;
};

export type CreateSwapRequest = {
  requestType: "swap";
  offered: MarketplaceSwapLeg;
  wanted: MarketplaceSwapLeg;
  region: MarketplaceRegion;
  cashDirection: "none" | "offer" | "request";
  cashAmount: number | null;
};

export type CreateMarketplaceRequest = CreateProcurementRequest | CreateSwapRequest;

export type CreateMarketplaceQuote = {
  demandId: string;
  unitPrice: number;
  leadTime: MarketplaceQuoteLeadTime;
  validDays: number;
  scopeNote: string;
};

export type CreateMarketplaceDraft = {
  title: string;
  category: ResourceCategory;
  capacity: string;
};

export type MarketplaceListResponse<T> = {
  items: T[];
  count: number;
  updatedAt: string;
  pageInfo: {
    hasMore: boolean;
    nextCursor: string | null;
    limit: number;
  };
};

export class MarketplaceInputError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "MarketplaceInputError";
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MarketplaceInputError("请求内容必须是对象。");
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== "string") throw new MarketplaceInputError(`${field} 格式不正确。`, field);
  const normalized = value.normalize("NFKC").trim();
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)) {
    throw new MarketplaceInputError(`${field} 包含不支持的控制字符。`, field);
  }
  if (normalized.length < min || normalized.length > max) {
    throw new MarketplaceInputError(`${field} 长度应为 ${min}–${max} 个字符。`, field);
  }
  return normalized;
}

function positiveNumber(value: unknown, field: string, max = 10_000_000) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) {
    throw new MarketplaceInputError(`${field} 必须是有效的正数。`, field);
  }
  return value;
}

function categoryValue(value: unknown, field: string) {
  if (typeof value !== "string" || !marketplaceCategories.includes(value as ResourceCategory)) {
    throw new MarketplaceInputError(`${field} 不在支持范围内。`, field);
  }
  return value as ResourceCategory;
}

function pricingUnitValue(value: unknown, category: ResourceCategory, field: string) {
  if (typeof value !== "string" || !categoryPricingUnits[category].includes(value as PricingUnit)) {
    throw new MarketplaceInputError(`${field} 与资源类型不匹配。`, field);
  }
  return value as PricingUnit;
}

function swapLegValue(value: unknown, field: string): MarketplaceSwapLeg {
  const leg = objectValue(value);
  const category = categoryValue(leg.category, `${field}.category`);
  return {
    category,
    pricingUnit: pricingUnitValue(leg.pricingUnit, category, `${field}.pricingUnit`),
    quantity: positiveNumber(leg.quantity, `${field}.quantity`),
    description: boundedStringValue(leg.description, `${field}.description`, 8, 500),
  };
}

function boundedStringValue(value: unknown, field: string, min: number, max: number) {
  const normalized = stringValue(value, field, min, max);
  const containsContactData = /(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?86[- ]?)?1[3-9]\d{9})/iu.test(normalized);
  if (containsContactData) {
    throw new MarketplaceInputError(`${field} 请勿填写邮箱、手机号或外部链接。`, field);
  }
  return normalized;
}

function supportedStringValue<const T extends readonly string[]>(
  value: unknown,
  field: string,
  supported: T,
): T[number] {
  const normalized = stringValue(value, field, 1, 100);
  if (!(supported as readonly string[]).includes(normalized)) {
    throw new MarketplaceInputError(`${field} 不在支持范围内。`, field);
  }
  return normalized as T[number];
}

export function parseCreateRequest(value: unknown): CreateMarketplaceRequest {
  const input = objectValue(value);
  if (input.requestType === "procurement") {
    if (input.dealMode !== "rental" && input.dealMode !== "service") {
      throw new MarketplaceInputError("交易方式不受支持。", "dealMode");
    }
    const category = categoryValue(input.category, "category");
    const deliveryDate = stringValue(input.deliveryDate, "deliveryDate", 10, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || Number.isNaN(Date.parse(`${deliveryDate}T00:00:00Z`))) {
      throw new MarketplaceInputError("开始日期格式不正确。", "deliveryDate");
    }
    const parsedDate = new Date(`${deliveryDate}T00:00:00Z`);
    if (parsedDate.toISOString().slice(0, 10) !== deliveryDate) {
      throw new MarketplaceInputError("开始日期不是有效的日历日期。", "deliveryDate");
    }
    const today = new Date().toISOString().slice(0, 10);
    const latest = new Date();
    latest.setUTCFullYear(latest.getUTCFullYear() + 3);
    if (deliveryDate < today || deliveryDate > latest.toISOString().slice(0, 10)) {
      throw new MarketplaceInputError("开始日期应在今天至未来三年内。", "deliveryDate");
    }
    const pricingUnit = pricingUnitValue(input.pricingUnit, category, "pricingUnit");
    const usesDurationHours = ["卡时", "服务器时", "模型实例时", "预留容量时"].includes(pricingUnit);
    if (!usesDurationHours && input.durationHours !== null && input.durationHours !== undefined) {
      throw new MarketplaceInputError("该计价单位不使用持续小时，请按计价单位填写数量。", "durationHours");
    }
    return {
      requestType: "procurement",
      dealMode: input.dealMode,
      category,
      pricingUnit,
      quantity: positiveNumber(input.quantity, "quantity"),
      durationHours: usesDurationHours ? positiveNumber(input.durationHours, "durationHours", 1_000_000) : null,
      region: supportedStringValue(input.region, "region", marketplaceRegions),
      deliveryDate,
      requirements: boundedStringValue(input.requirements, "requirements", 8, 1_000),
    };
  }

  if (input.requestType === "swap") {
    if (input.cashDirection !== "none" && input.cashDirection !== "offer" && input.cashDirection !== "request") {
      throw new MarketplaceInputError("补差方向不受支持。", "cashDirection");
    }
    const cashAmount = input.cashDirection === "none" ? null : positiveNumber(input.cashAmount, "cashAmount", 100_000_000);
    return {
      requestType: "swap",
      offered: swapLegValue(input.offered, "offered"),
      wanted: swapLegValue(input.wanted, "wanted"),
      region: supportedStringValue(input.region, "region", marketplaceRegions),
      cashDirection: input.cashDirection,
      cashAmount,
    };
  }

  throw new MarketplaceInputError("需求类型不受支持。", "requestType");
}

export function parseCreateQuote(value: unknown): CreateMarketplaceQuote {
  const input = objectValue(value);
  const validDays = positiveNumber(input.validDays, "validDays", 90);
  if (!Number.isInteger(validDays)) throw new MarketplaceInputError("有效期必须是整数天。", "validDays");
  return {
    demandId: stringValue(input.demandId, "demandId", 8, 80),
    unitPrice: positiveNumber(input.unitPrice, "unitPrice", 100_000_000),
    leadTime: supportedStringValue(input.leadTime, "leadTime", marketplaceQuoteLeadTimes),
    validDays,
    scopeNote: boundedStringValue(input.scopeNote, "scopeNote", 8, 1_000),
  };
}

export function parseCreateDraft(value: unknown): CreateMarketplaceDraft {
  const input = objectValue(value);
  return {
    title: stringValue(input.title, "title", 3, 100),
    category: categoryValue(input.category, "category"),
    capacity: boundedStringValue(input.capacity, "capacity", 8, 500),
  };
}

export function createMarketplaceId(prefix: "R" | "X" | "Q" | "D" | "E") {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const random = crypto.randomUUID().replaceAll("-", "").toUpperCase();
  return `KAI-${prefix}-${date}-${random}`;
}
