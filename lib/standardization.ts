export const KAI_SCH_POLICY = Object.freeze({
  version: "KAI-SCH-V1",
  unitCode: "KAI-SCH",
  benchmarkLabel: "H100 SXM5 80GB GPU 卡时市场中位价",
  minSampleCount: 5,
  maxSampleAgeSeconds: 7 * 24 * 60 * 60,
  scale: BigInt(1_000_000),
  formula: "NATIVE_MARKET_PRICE_DIVIDED_BY_KAI_BENCHMARK_P50",
} as const);

export const STANDARDIZATION_PRODUCTS = Object.freeze({
  GPU_COMPUTE: {
    productLabel: "GPU 算力",
    nativeUnitCode: "GPU_HOUR",
    nativeUnitLabel: "卡时",
    priceBasisBaseUnits: BigInt(3_600),
  },
  MODEL_INSTANCE: {
    productLabel: "模型实例",
    nativeUnitCode: "MODEL_INSTANCE_HOUR",
    nativeUnitLabel: "模型实例时",
    priceBasisBaseUnits: BigInt(3_600),
  },
  TOKEN_THROUGHPUT: {
    productLabel: "Token 吞吐容量",
    nativeUnitCode: "M_TOKEN_CAPACITY_HOUR",
    nativeUnitLabel: "百万 Token 容量时",
    priceBasisBaseUnits: BigInt(3_600_000),
  },
  NAS_STORAGE: {
    productLabel: "NAS 存储容量",
    nativeUnitCode: "TIB_HOUR",
    nativeUnitLabel: "TiB·时",
    priceBasisBaseUnits: BigInt(3_686_400),
  },
  RACK_SPACE: {
    productLabel: "机柜容量",
    nativeUnitCode: "RACK_HOUR",
    nativeUnitLabel: "柜时",
    priceBasisBaseUnits: BigInt(3_600),
  },
} as const);

export const STANDARDIZATION_PRODUCT_VERSIONS = Object.freeze({
  "PV-GPU-H100-SXM5-80GB": { productCode: "GPU_COMPUTE", productLabel: "NVIDIA H100 SXM5 80GB" },
  "PV-GPU-H100-PCIE-80GB": { productCode: "GPU_COMPUTE", productLabel: "NVIDIA H100 PCIe 80GB" },
  "PV-GPU-A100-SXM4-80GB": { productCode: "GPU_COMPUTE", productLabel: "NVIDIA A100 SXM4 80GB" },
  "PV-GPU-H20-PCIE-96GB": { productCode: "GPU_COMPUTE", productLabel: "NVIDIA H20 PCIe 96GB" },
  "PV-GPU-RTX4090-PCIE-24GB": { productCode: "GPU_COMPUTE", productLabel: "NVIDIA GeForce RTX 4090 24GB" },
  "PV-MODEL-DEEPSEEK-V4-PRO-STANDARD-V1": { productCode: "MODEL_INSTANCE", productLabel: "DeepSeek V4 Pro 标准实例" },
  "PV-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1": { productCode: "TOKEN_THROUGHPUT", productLabel: "DeepSeek V4 Pro 标准 Token 吞吐容量" },
  "PV-NAS-NFS41-BALANCED-1TIB-V1": { productCode: "NAS_STORAGE", productLabel: "托管 NFS 4.1 均衡存储 1 TiB" },
  "PV-RACK-42U-10KW-MANAGED-V1": { productCode: "RACK_SPACE", productLabel: "42U 10kW 托管共址空间" },
} as const satisfies Readonly<Record<string, { productCode: keyof typeof STANDARDIZATION_PRODUCTS; productLabel: string }>>);

export const KAI_STANDARD_UNIT_CATALOG = Object.freeze([
  { unitCode: "GPU_HOUR", label: "GPU 卡时", status: "ENABLED", productCode: "GPU_COMPUTE", comparisonOnly: false },
  { unitCode: "SERVER_HOUR", label: "服务器时", status: "PLANNED", comparisonOnly: false },
  { unitCode: "PHYSICAL_CORE_HOUR", label: "物理核时", status: "PLANNED", comparisonOnly: false },
  { unitCode: "VCPU_HOUR", label: "vCPU 时", status: "PLANNED", comparisonOnly: false },
  { unitCode: "LANGUAGE_MODEL_HOUR", label: "语模时", status: "PLANNED", comparisonOnly: false },
  { unitCode: "MODEL_INSTANCE_HOUR", label: "推理模型实例时", status: "ENABLED", productCode: "MODEL_INSTANCE", comparisonOnly: false },
  { unitCode: "VISION_MODEL_HOUR", label: "视模时", status: "PLANNED", comparisonOnly: false },
  { unitCode: "M_TOKEN_CAPACITY_HOUR", label: "百万 Token 容量时", status: "ENABLED", productCode: "TOKEN_THROUGHPUT", comparisonOnly: false },
  { unitCode: "TIB_HOUR", label: "TiB 时", status: "ENABLED", productCode: "NAS_STORAGE", comparisonOnly: false },
  { unitCode: "RACK_HOUR", label: "柜时", status: "ENABLED", productCode: "RACK_SPACE", comparisonOnly: false },
  { unitCode: "STANDARD_RACK_MONTH_720", label: "标准柜月（720 柜时）", status: "PLANNED", comparisonOnly: true },
  { unitCode: "KW_RACK_HOUR", label: "kW 柜时", status: "PLANNED", comparisonOnly: false },
] as const satisfies ReadonlyArray<Readonly<{
  unitCode: string;
  label: string;
  status: "ENABLED" | "PLANNED";
  productCode?: keyof typeof STANDARDIZATION_PRODUCTS;
  comparisonOnly: boolean;
}>>);

export type StandardizationProductCode = keyof typeof STANDARDIZATION_PRODUCTS;
export type StandardizationSnapshotStatus = "CURRENT" | "STALE" | "UNAVAILABLE";

export type StandardizationSample = Readonly<{
  sampleId: string;
  productCode: StandardizationProductCode;
  productVersionId: string;
  region: string;
  unitPriceCnyMicros: string;
  benchmark: boolean;
  promotional: boolean;
  marketIndexEligible: boolean;
  sourceSystem: "MARKETPLACE" | "EXCHANGE" | "SUPPLY_PILOT" | "CLOUD_VENDOR";
  observedAt: string;
}>;

export type AppendStandardizationSnapshot = Readonly<{
  asOf: string;
  expiresAt: string;
  samples: readonly StandardizationSample[];
}>;

export type StandardizationMutationContext = Readonly<{
  actorId: string;
  idempotencyKey: string;
  payloadHash: string;
  reason: string;
}>;

export type KaiStandardQuote = Readonly<{
  productCode: StandardizationProductCode;
  productVersionId: string;
  productLabel: string;
  nativeUnitCode: string;
  nativeUnitLabel: string;
  region: string;
  p25KaiSch: string;
  p50KaiSch: string;
  p75KaiSch: string;
  sampleCount: number;
  asOf: string;
  expiresAt: string;
  policyVersion: string;
}>;

export type KaiStandardQuoteEnvelope = Readonly<{
  policy: Readonly<{ version: string; unitCode: string; benchmarkLabel: string }>;
  snapshot: Readonly<{
    asOf: string;
    expiresAt: string;
    status: StandardizationSnapshotStatus;
    p25CnyMicros: string | null;
    p50CnyMicros: string | null;
    p75CnyMicros: string | null;
    sampleCount: number;
  }>;
  quotes: readonly KaiStandardQuote[];
}>;

export type KaiHoursAccountEnvelope = Readonly<{
  policyVersion: string;
  asOf: string;
  expiresAt: string;
  status: StandardizationSnapshotStatus;
  summary: Readonly<{
    depositedKaiSch: string;
    availableKaiSch: string;
    earnedKaiSch: string;
    settlementCnyCents: string;
  }>;
  positions: ReadonlyArray<Readonly<{
    productCode: StandardizationProductCode;
    productVersionId: string;
    productLabel: string;
    nativeAmount: string;
    nativeUnitLabel: string;
    availableKaiSch: string;
    heldKaiSch: string;
  }>>;
  income: Readonly<{
    pendingCnyCents: string;
    payableCnyCents: string;
    settledCnyCents: string;
  }>;
}>;

export class StandardizationInputError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "StandardizationInputError";
    this.field = field;
  }
}

export class StandardizationIdempotencyError extends Error {
  constructor() {
    super("STANDARDIZATION_IDEMPOTENCY_CONFLICT");
    this.name = "StandardizationIdempotencyError";
  }
}

export class StandardizationSnapshotConflictError extends Error {
  constructor() {
    super("STANDARDIZATION_SNAPSHOT_CONFLICT");
    this.name = "StandardizationSnapshotConflictError";
  }
}

function positiveDecimalInteger(value: unknown, field: string) {
  if (typeof value !== "string" || !/^[1-9]\d{0,18}$/u.test(value)) {
    throw new StandardizationInputError(`${field} 必须是正整数字符串。`, field);
  }
  return value;
}

function utcInstant(value: unknown, field: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new StandardizationInputError(`${field} 必须是 UTC 时间。`, field);
  }
  return new Date(value).toISOString();
}

export function parseAppendStandardizationSnapshot(value: unknown): AppendStandardizationSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StandardizationInputError("快照输入必须是对象。");
  }
  const input = value as Record<string, unknown>;
  const asOf = utcInstant(input.asOf, "asOf");
  const expiresAt = utcInstant(input.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(asOf)) {
    throw new StandardizationInputError("expiresAt 必须晚于 asOf。", "expiresAt");
  }
  if (!Array.isArray(input.samples) || input.samples.length === 0 || input.samples.length > 10_000) {
    throw new StandardizationInputError("samples 必须包含 1 至 10000 条样本。", "samples");
  }
  const ids = new Set<string>();
  const samples = input.samples.map((raw, index): StandardizationSample => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new StandardizationInputError(`samples[${index}] 必须是对象。`, `samples[${index}]`);
    }
    const item = raw as Record<string, unknown>;
    const sampleId = typeof item.sampleId === "string" && /^[A-Za-z0-9._:-]{8,128}$/u.test(item.sampleId)
      ? item.sampleId : null;
    if (!sampleId) throw new StandardizationInputError("sampleId 格式无效。", `samples[${index}].sampleId`);
    if (ids.has(sampleId)) throw new StandardizationInputError("sampleId 不能重复。", `samples[${index}].sampleId`);
    ids.add(sampleId);
    const productCode = item.productCode;
    if (typeof productCode !== "string" || !(productCode in STANDARDIZATION_PRODUCTS)) {
      throw new StandardizationInputError("productCode 不受支持。", `samples[${index}].productCode`);
    }
    const region = typeof item.region === "string" ? item.region.trim() : "";
    if (region.length < 2 || region.length > 40) {
      throw new StandardizationInputError("region 长度无效。", `samples[${index}].region`);
    }
    const sourceSystem = item.sourceSystem;
    if (!(["MARKETPLACE", "EXCHANGE", "SUPPLY_PILOT", "CLOUD_VENDOR"] as const).includes(sourceSystem as never)) {
      throw new StandardizationInputError("sourceSystem 不受支持。", `samples[${index}].sourceSystem`);
    }
    if (typeof item.benchmark !== "boolean" || typeof item.promotional !== "boolean"
      || typeof item.marketIndexEligible !== "boolean") {
      throw new StandardizationInputError("样本资格字段必须是布尔值。", `samples[${index}]`);
    }
    const productVersionId = typeof item.productVersionId === "string" && /^[A-Za-z0-9._:-]{8,128}$/u.test(item.productVersionId)
      ? item.productVersionId : null;
    if (!productVersionId) {
      throw new StandardizationInputError("productVersionId 格式无效。", `samples[${index}].productVersionId`);
    }
    const productVersion = STANDARDIZATION_PRODUCT_VERSIONS[productVersionId as keyof typeof STANDARDIZATION_PRODUCT_VERSIONS];
    if (!productVersion || productVersion.productCode !== productCode) {
      throw new StandardizationInputError(
        "productVersionId 不在受控目录中，或与 productCode 不匹配。",
        `samples[${index}].productVersionId`,
      );
    }
    if (item.benchmark && (productCode !== "GPU_COMPUTE" || productVersionId !== "PV-GPU-H100-SXM5-80GB")) {
      throw new StandardizationInputError(
        "KAI-SCH v1 基准样本必须属于 H100 SXM5 80GB 产品版本。",
        `samples[${index}].productVersionId`,
      );
    }
    const observedAt = utcInstant(item.observedAt, `samples[${index}].observedAt`);
    if (Date.parse(observedAt) > Date.parse(asOf)) {
      throw new StandardizationInputError("observedAt 不能晚于快照 asOf。", `samples[${index}].observedAt`);
    }
    return {
      sampleId,
      productCode: productCode as StandardizationProductCode,
      productVersionId,
      region,
      unitPriceCnyMicros: positiveDecimalInteger(item.unitPriceCnyMicros, `samples[${index}].unitPriceCnyMicros`),
      benchmark: item.benchmark,
      promotional: item.promotional,
      marketIndexEligible: item.marketIndexEligible,
      sourceSystem: sourceSystem as StandardizationSample["sourceSystem"],
      observedAt,
    };
  });
  return { asOf, expiresAt, samples };
}

export function sampleIsIndexEligible(sample: StandardizationSample, asOf?: string) {
  const fresh = asOf === undefined
    || Date.parse(sample.observedAt) >= Date.parse(asOf) - KAI_SCH_POLICY.maxSampleAgeSeconds * 1_000;
  return sample.marketIndexEligible && !sample.promotional && sample.sourceSystem !== "SUPPLY_PILOT" && fresh;
}

export function divideHalfEven(numerator: bigint, denominator: bigint) {
  if (numerator < BigInt(0) || denominator <= BigInt(0)) throw new RangeError("half-even division requires non-negative numerator and positive denominator");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubled = remainder * BigInt(2);
  if (doubled > denominator || (doubled === denominator && quotient % BigInt(2) === BigInt(1))) return quotient + BigInt(1);
  return quotient;
}

export function deriveKaiSchMicros(input: {
  nativeCapacityBaseUnits: bigint;
  nativePriceBasisBaseUnits: bigint;
  nativeIndexPriceCnyMicros: bigint;
  benchmarkP50CnyMicros: bigint;
}) {
  if (input.nativeCapacityBaseUnits < BigInt(0) || input.nativePriceBasisBaseUnits <= BigInt(0)
    || input.nativeIndexPriceCnyMicros <= BigInt(0) || input.benchmarkP50CnyMicros <= BigInt(0)) {
    throw new RangeError("standardization inputs are outside the positive domain");
  }
  return divideHalfEven(
    input.nativeCapacityBaseUnits * input.nativeIndexPriceCnyMicros * KAI_SCH_POLICY.scale,
    input.nativePriceBasisBaseUnits * input.benchmarkP50CnyMicros,
  );
}

export function microKaiToDecimal(value: bigint) {
  if (value < BigInt(0)) throw new RangeError("KAI-SCH value cannot be negative");
  const integer = value / KAI_SCH_POLICY.scale;
  const fraction = (value % KAI_SCH_POLICY.scale).toString().padStart(6, "0");
  return `${integer}.${fraction}`;
}

export function baseUnitsToNativeDecimal(baseUnits: bigint, priceBasisBaseUnits: bigint) {
  if (baseUnits < BigInt(0) || priceBasisBaseUnits <= BigInt(0)) throw new RangeError("native capacity inputs are invalid");
  return microKaiToDecimal(divideHalfEven(baseUnits * KAI_SCH_POLICY.scale, priceBasisBaseUnits));
}

export function nearestRankQuartiles(values: readonly bigint[]) {
  if (values.length === 0) throw new RangeError("at least one value is required");
  const sorted = [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const at = (numerator: number) => sorted[Math.floor((sorted.length - 1) * numerator / 4)]!;
  return { p25: at(1), p50: at(2), p75: at(3) };
}

export function unavailableQuoteEnvelope(now = new Date()): KaiStandardQuoteEnvelope {
  const at = now.toISOString();
  return {
    policy: {
      version: KAI_SCH_POLICY.version,
      unitCode: KAI_SCH_POLICY.unitCode,
      benchmarkLabel: KAI_SCH_POLICY.benchmarkLabel,
    },
    snapshot: {
      asOf: at,
      expiresAt: at,
      status: "UNAVAILABLE",
      p25CnyMicros: null,
      p50CnyMicros: null,
      p75CnyMicros: null,
      sampleCount: 0,
    },
    quotes: [],
  };
}
