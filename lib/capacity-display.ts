import type { EnabledCapacityDescriptor } from "./exchange";

export type EnabledCapacityProductCode = EnabledCapacityDescriptor["productCode"];

export type CapacityDisplayVocabulary = Readonly<{
  productCode: EnabledCapacityProductCode;
  resourceNoun: string;
  marketLabel: string;
  rateFieldLabel: string;
  rateUnitShort: string;
  capacityFieldLabel: string;
  capacityUnitShort: string;
  pricingUnitLabel: string;
  availabilityLabel: string;
  deliveryNoun: string;
  listingAction: string;
  purchaseAction: string;
}>;

const VOCABULARY: Readonly<Record<EnabledCapacityProductCode, CapacityDisplayVocabulary>> = {
  GPU_COMPUTE: {
    productCode: "GPU_COMPUTE",
    resourceNoun: "GPU 算力",
    marketLabel: "GPU 容量市场",
    rateFieldLabel: "并行卡数",
    rateUnitShort: "卡",
    capacityFieldLabel: "GPU 小时",
    capacityUnitShort: "GPU 小时",
    pricingUnitLabel: "GPU 小时",
    availabilityLabel: "可用 GPU 小时",
    deliveryNoun: "算力环境",
    listingAction: "上架 GPU 容量",
    purchaseAction: "购买 GPU 容量",
  },
  MODEL_INSTANCE: {
    productCode: "MODEL_INSTANCE",
    resourceNoun: "模型实例",
    marketLabel: "模型实例市场",
    rateFieldLabel: "实例数量",
    rateUnitShort: "个实例",
    capacityFieldLabel: "模型实例时",
    capacityUnitShort: "模型实例时",
    pricingUnitLabel: "模型实例时",
    availabilityLabel: "可用模型实例时",
    deliveryNoun: "模型服务端点",
    listingAction: "上架模型实例容量",
    purchaseAction: "购买模型实例容量",
  },
  TOKEN_THROUGHPUT: {
    productCode: "TOKEN_THROUGHPUT",
    resourceNoun: "Token 吞吐容量",
    marketLabel: "Token 吞吐容量市场",
    rateFieldLabel: "预留吞吐",
    rateUnitShort: "百万 Token/小时",
    capacityFieldLabel: "Token 容量时",
    capacityUnitShort: "百万 Token 容量时",
    pricingUnitLabel: "百万 Token 容量时",
    availabilityLabel: "可用 Token 容量时",
    deliveryNoun: "Token 服务端点",
    listingAction: "上架 Token 吞吐容量",
    purchaseAction: "购买 Token 吞吐容量",
  },
  NAS_STORAGE: {
    productCode: "NAS_STORAGE",
    resourceNoun: "NAS 存储",
    marketLabel: "NAS 容量市场",
    rateFieldLabel: "预留存储容量",
    rateUnitShort: "TiB",
    capacityFieldLabel: "NAS 容量时",
    capacityUnitShort: "TiB·小时",
    pricingUnitLabel: "TiB·小时",
    availabilityLabel: "可用 NAS 容量时",
    deliveryNoun: "NAS 存储卷",
    listingAction: "上架 NAS 容量",
    purchaseAction: "购买 NAS 容量",
  },
  RACK_SPACE: {
    productCode: "RACK_SPACE",
    resourceNoun: "整柜托管",
    marketLabel: "机柜容量市场",
    rateFieldLabel: "整柜数量",
    rateUnitShort: "柜",
    capacityFieldLabel: "机柜容量时",
    capacityUnitShort: "柜时",
    pricingUnitLabel: "柜时",
    availabilityLabel: "可用机柜容量时",
    deliveryNoun: "机柜托管服务",
    listingAction: "上架机柜容量",
    purchaseAction: "购买机柜容量",
  },
};

export function capacityDisplay(productCode: EnabledCapacityProductCode): CapacityDisplayVocabulary {
  const vocabulary = VOCABULARY[productCode];
  if (!vocabulary) {
    throw new Error(`Unsupported capacity product: ${String(productCode)}`);
  }
  return vocabulary;
}

export function formatRateUnits(productCode: EnabledCapacityProductCode, rateUnits: number) {
  if (!Number.isSafeInteger(rateUnits) || rateUnits < 0) {
    throw new RangeError("rateUnits must be a non-negative safe integer.");
  }
  const vocabulary = capacityDisplay(productCode);
  const value = productCode === "TOKEN_THROUGHPUT"
    ? rateUnits / 1_000
    : productCode === "NAS_STORAGE"
      ? rateUnits / 1_024
      : rateUnits;
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(value)} ${vocabulary.rateUnitShort}`;
}

export function formatCapacityHours(productCode: EnabledCapacityProductCode, capacityBaseUnits: number) {
  if (!Number.isSafeInteger(capacityBaseUnits) || capacityBaseUnits < 0) {
    throw new RangeError("capacityBaseUnits must be a non-negative safe integer.");
  }
  const vocabulary = capacityDisplay(productCode);
  const priceBasisBaseUnits = productCode === "TOKEN_THROUGHPUT"
    ? 3_600_000
    : productCode === "NAS_STORAGE"
      ? 3_686_400
      : 3_600;
  const value = capacityBaseUnits / priceBasisBaseUnits;
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(value)} ${vocabulary.capacityUnitShort}`;
}

export function formatUnitPrice(productCode: EnabledCapacityProductCode, unitPriceMicros: number) {
  if (!Number.isSafeInteger(unitPriceMicros) || unitPriceMicros < 0) {
    throw new RangeError("unitPriceMicros must be a non-negative safe integer.");
  }
  const vocabulary = capacityDisplay(productCode);
  return `${new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(unitPriceMicros / 1_000_000)} / ${vocabulary.pricingUnitLabel}`;
}

export function formatStandardMonthComparison(productCode: EnabledCapacityProductCode, unitPriceMicros: number) {
  if (productCode !== "RACK_SPACE") return null;
  if (!Number.isSafeInteger(unitPriceMicros) || unitPriceMicros < 0) {
    throw new RangeError("unitPriceMicros must be a non-negative safe integer.");
  }
  return `${new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((unitPriceMicros * 720) / 1_000_000)} / 标准柜月（720 小时）`;
}
