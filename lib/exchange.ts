import { ExchangeInputError } from "./server/exchange-errors.ts";

export const EXCHANGE_PRODUCT_CODES = [
  "GPU_COMPUTE",
  "TOKEN_USAGE",
  "TOKEN_THROUGHPUT",
  "MODEL_INSTANCE",
  "NAS_STORAGE",
  "RACK_SPACE",
  "POWER_CAPACITY",
] as const;
export type ExchangeProductCode = (typeof EXCHANGE_PRODUCT_CODES)[number];

export const EXCHANGE_UNIT_CODES = [
  "GPU_HOUR",
  "INPUT_TOKEN_1M",
  "CACHED_TOKEN_1M",
  "OUTPUT_TOKEN_1M",
  "M_TOKEN_CAPACITY_HOUR",
  "MODEL_INSTANCE_HOUR",
  "TIB_HOUR",
  "RACK_HOUR",
  "KW_HOUR",
] as const;
export type ExchangeUnitCode = (typeof EXCHANGE_UNIT_CODES)[number];

export const EXCHANGE_RATE_UNIT_CODES = [
  "GPU",
  "MODEL_INSTANCE",
  "MILLI_M_TOKEN_PER_HOUR",
  "GIB_STORAGE",
  "RACK",
] as const;
export type RateUnitCode = (typeof EXCHANGE_RATE_UNIT_CODES)[number];

export const EXCHANGE_FULFILLMENT_MODELS = [
  "GPU_ALLOCATION",
  "MODEL_INSTANCE_ALLOCATION",
  "TOKEN_THROUGHPUT_RESERVATION",
  "NAS_VOLUME_ALLOCATION",
  "RACK_COLOCATION_ALLOCATION",
] as const;
export type FulfillmentModel = (typeof EXCHANGE_FULFILLMENT_MODELS)[number];

export type ProductCapacityPolicy = Readonly<{
  id: string;
  productVersionId: string | null;
  policyKey: string;
  productCode: "GPU_COMPUTE" | "MODEL_INSTANCE" | "TOKEN_THROUGHPUT" | "NAS_STORAGE" | "RACK_SPACE";
  rateUnitCode: RateUnitCode;
  fulfillmentModel: FulfillmentModel;
  pricingUnitCode: "GPU_HOUR" | "MODEL_INSTANCE_HOUR" | "M_TOKEN_CAPACITY_HOUR" | "TIB_HOUR" | "RACK_HOUR";
  rateUnitScaleNumerator: number;
  rateUnitScaleDenominator: number;
  rateUnitReferenceCode: "GPU" | "MODEL_INSTANCE" | "M_TOKEN_PER_HOUR" | "TIB_STORAGE" | "RACK";
  priceBasisBaseUnits: number;
  featureStatus: "ENABLED" | "DISABLED";
  identitySpec: Readonly<Record<string, string | number | boolean>>;
  immutableHash: string;
  createdAt: string;
}>;

export type OrderContractSnapshot = Readonly<{
  id: string;
  orderId: string;
  listingVersionId: string;
  productVersionId: string;
  capacityPolicyId: string;
  productCode: ProductCapacityPolicy["productCode"];
  rateUnitCode: RateUnitCode;
  fulfillmentModel: FulfillmentModel;
  pricingUnitCode: ProductCapacityPolicy["pricingUnitCode"];
  rateUnits: number;
  durationSeconds: number;
  capacityBaseUnits: number;
  unitPriceMicros: number;
  priceBasisBaseUnits: number;
  grossAmountCents: number;
  currency: "CNY";
  productIdentity: Record<string, unknown>;
  sla: Record<string, unknown>;
  evidencePolicyVersion: string;
  snapshotDigest: string;
  createdAt: string;
}>;

export type MeterInterval = Readonly<{
  id: string;
  meteringSessionId: string;
  orderId: string;
  capacityPolicyId: string;
  sequenceNumber: number;
  intervalStartAt: string;
  intervalEndAt: string;
  durationSeconds: number;
  reservedRateUnits: number;
  provenRateUnits: number;
  scheduledCapacityBaseUnits: number;
  availableCapacityBaseUnits: number;
  unavailableCapacityBaseUnits: number;
  unprovenCapacityBaseUnits: number;
  evidenceStatus: "PROVEN" | "UNAVAILABLE" | "UNPROVEN";
  adapter: "TEST" | "CONNECTOR" | "CLOUD_API" | "KAI_GATEWAY";
  evidenceDigest: string;
  createdAt: string;
}>;

type MeterEvidenceBase = Readonly<{
  id: string;
  meterIntervalId: string;
  source: "TEST" | "CONNECTOR" | "CLOUD_API" | "KAI_GATEWAY";
  payloadDigest: string;
  observedAt: string;
  createdAt: string;
}>;

export type MeterEvidence =
  | (MeterEvidenceBase & Readonly<{ evidenceType: "MODEL_IDENTITY"; modelIdentityDigest: string }>)
  | (MeterEvidenceBase & Readonly<{ evidenceType: "STORAGE_IDENTITY" | "FACILITY_IDENTITY"; identityDigest: string }>)
  | (MeterEvidenceBase & Readonly<{
    evidenceType: "AVAILABILITY" | "THROUGHPUT" | "INSTANCE_HEARTBEAT" | "STORAGE_AVAILABILITY" | "RACK_AVAILABILITY";
  }>);

export const CNY_MICROS_PER_CENT = BigInt(10_000);
export const GPU_HOUR_PRICE_BASIS_BASE_UNITS = BigInt(3_600);
export const MODEL_INSTANCE_HOUR_PRICE_BASIS_BASE_UNITS = BigInt(3_600);
export const M_TOKEN_CAPACITY_HOUR_PRICE_BASIS_BASE_UNITS = BigInt(3_600_000);
export const TIB_HOUR_PRICE_BASIS_BASE_UNITS = BigInt(3_686_400);
export const RACK_HOUR_PRICE_BASIS_BASE_UNITS = BigInt(3_600);

function positiveBigInt(value: bigint, field: string) {
  if (value <= BigInt(0)) throw new RangeError(`${field} must be a positive integer.`);
  return value;
}

export function deriveCapacityBaseUnits(rateUnits: bigint, durationSeconds: bigint) {
  return positiveBigInt(rateUnits, "rateUnits") * positiveBigInt(durationSeconds, "durationSeconds");
}

export function deriveCapacityAmountCents(input: {
  unitPriceMicros: bigint;
  capacityBaseUnits: bigint;
  priceBasisBaseUnits: bigint;
}) {
  const unitPriceMicros = positiveBigInt(input.unitPriceMicros, "unitPriceMicros");
  const capacityBaseUnits = positiveBigInt(input.capacityBaseUnits, "capacityBaseUnits");
  const denominator = positiveBigInt(input.priceBasisBaseUnits, "priceBasisBaseUnits") * CNY_MICROS_PER_CENT;
  const numerator = unitPriceMicros * capacityBaseUnits;
  return (numerator + denominator - BigInt(1)) / denominator;
}

export function deriveCommissionEstimateCents(commissionBaseCents: number) {
  if (!Number.isSafeInteger(commissionBaseCents) || commissionBaseCents < 0) {
    throw new RangeError("commissionBaseCents must be a non-negative safe integer.");
  }
  return Number(BigInt(commissionBaseCents) * BigInt(300) / BigInt(10_000));
}

export type ExchangeWorkspaceRole = "buyer" | "supplier" | "ops";
export type Interruptibility = "NON_INTERRUPTIBLE" | "INTERRUPTIBLE";

export type ProductVersion = {
  id: string;
  productCode: ExchangeProductCode;
  pricingUnitCode: ExchangeUnitCode;
  displayName: string;
  manufacturer: string;
  model: string;
  formFactor: string;
  specs: Record<string, string | number | boolean>;
  createdAt: string;
};

export type EnabledCapacityDescriptor = Readonly<
  | {
    productCode: "GPU_COMPUTE";
    rateUnitCode: "GPU";
    fulfillmentModel: "GPU_ALLOCATION";
    pricingUnitCode: "GPU_HOUR";
    priceBasisBaseUnits: number;
  }
  | {
    productCode: "MODEL_INSTANCE";
    rateUnitCode: "MODEL_INSTANCE";
    fulfillmentModel: "MODEL_INSTANCE_ALLOCATION";
    pricingUnitCode: "MODEL_INSTANCE_HOUR";
    priceBasisBaseUnits: number;
  }
  | {
    productCode: "TOKEN_THROUGHPUT";
    rateUnitCode: "MILLI_M_TOKEN_PER_HOUR";
    fulfillmentModel: "TOKEN_THROUGHPUT_RESERVATION";
    pricingUnitCode: "M_TOKEN_CAPACITY_HOUR";
    priceBasisBaseUnits: number;
  }
  | {
    productCode: "NAS_STORAGE";
    rateUnitCode: "GIB_STORAGE";
    fulfillmentModel: "NAS_VOLUME_ALLOCATION";
    pricingUnitCode: "TIB_HOUR";
    priceBasisBaseUnits: number;
  }
  | {
    productCode: "RACK_SPACE";
    rateUnitCode: "RACK";
    fulfillmentModel: "RACK_COLOCATION_ALLOCATION";
    pricingUnitCode: "RACK_HOUR";
    priceBasisBaseUnits: number;
  }
>;

type ResourceAssetBase = {
  id: string;
  supplierActorId: string;
  productVersionId: string;
  productCode: EnabledCapacityDescriptor["productCode"];
  rateUnitCode: EnabledCapacityDescriptor["rateUnitCode"];
  fulfillmentModel: EnabledCapacityDescriptor["fulfillmentModel"];
  pricingUnitCode: EnabledCapacityDescriptor["pricingUnitCode"];
  priceBasisBaseUnits: number;
  title: string;
  region: string;
  deliveryForm: string;
  totalRateUnits: number;
  interruptibility: Interruptibility;
  networkScope: string;
  status: "DECLARED" | "VERIFIED" | "REJECTED" | "SUSPENDED" | "WITHDRAWN";
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ResourceAsset =
  | (ResourceAssetBase & { productCode: "GPU_COMPUTE"; rateUnitCode: "GPU"; totalParallelUnits: number })
  | (ResourceAssetBase & { productCode: "MODEL_INSTANCE"; rateUnitCode: "MODEL_INSTANCE" })
  | (ResourceAssetBase & { productCode: "TOKEN_THROUGHPUT"; rateUnitCode: "MILLI_M_TOKEN_PER_HOUR" })
  | (ResourceAssetBase & { productCode: "NAS_STORAGE"; rateUnitCode: "GIB_STORAGE" })
  | (ResourceAssetBase & { productCode: "RACK_SPACE"; rateUnitCode: "RACK" });

export type VerificationRun = {
  id: string;
  resourceAssetId: string;
  operatorActorId: string;
  method: "MANUAL" | "CONNECTOR" | "CLOUD_API";
  result: "PASS" | "FAIL";
  evidenceSummary: string;
  evidenceDigest: string;
  validUntil: string | null;
  createdAt: string;
};

type CapacityLotBase = {
  id: string;
  supplierActorId: string;
  resourceAssetId: string;
  verificationRunId: string;
  productCode: EnabledCapacityDescriptor["productCode"];
  rateUnitCode: EnabledCapacityDescriptor["rateUnitCode"];
  fulfillmentModel: EnabledCapacityDescriptor["fulfillmentModel"];
  pricingUnitCode: EnabledCapacityDescriptor["pricingUnitCode"];
  priceBasisBaseUnits: number;
  startAt: string;
  endAt: string;
  rateUnits: number;
  durationSeconds: number;
  capacityBaseUnits: number;
  interruptibility: Interruptibility;
  status: "READY" | "LISTED" | "SUSPENDED" | "EXPIRED" | "WITHDRAWN";
  allowedActions: ReadonlyArray<"CREATE_LISTING" | "WITHDRAW">;
  withdrawalEligibility: Readonly<{
    eligible: boolean;
    reasonCode:
      | "ELIGIBLE"
      | "LOT_NOT_READY"
      | "LISTING_HISTORY_EXISTS"
      | "RESERVATION_HISTORY_EXISTS"
      | "ALREADY_WITHDRAWN"
      | "TRANSFER_HISTORY_NOT_PRISTINE";
  }>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CapacityLot =
  | (CapacityLotBase & {
    productCode: "GPU_COMPUTE";
    rateUnitCode: "GPU";
    parallelUnits: number;
    capacityGpuSeconds: number;
    capacityGpuHours: number;
  })
  | (CapacityLotBase & { productCode: "MODEL_INSTANCE"; rateUnitCode: "MODEL_INSTANCE" })
  | (CapacityLotBase & { productCode: "TOKEN_THROUGHPUT"; rateUnitCode: "MILLI_M_TOKEN_PER_HOUR" })
  | (CapacityLotBase & { productCode: "NAS_STORAGE"; rateUnitCode: "GIB_STORAGE" })
  | (CapacityLotBase & { productCode: "RACK_SPACE"; rateUnitCode: "RACK" });

type ListingVersionBase = {
  id: string;
  listingId: string;
  versionNumber: number;
  supplierActorId: string;
  capacityLotId: string;
  productCode: EnabledCapacityDescriptor["productCode"];
  rateUnitCode: EnabledCapacityDescriptor["rateUnitCode"];
  fulfillmentModel: EnabledCapacityDescriptor["fulfillmentModel"];
  pricingUnitCode: EnabledCapacityDescriptor["pricingUnitCode"];
  priceBasisBaseUnits: number;
  unitPriceMicros: number;
  currency: "CNY";
  minRateUnits: number;
  maxRateUnits: number;
  minDurationMinutes: number;
  taxIncluded: boolean;
  energyIncluded: boolean;
  networkIncluded: boolean;
  scopeNote: string;
  sla: { availabilityPercent: number; responseMinutes: number };
  deliveryForm: string;
  validFrom: string;
  validUntil: string;
  status: "ACTIVE" | "WITHDRAWN" | "EXPIRED";
  createdAt: string;
};

export type ListingVersion =
  | (ListingVersionBase & {
    productCode: "GPU_COMPUTE";
    rateUnitCode: "GPU";
    pricingUnitCode: "GPU_HOUR";
    unitPriceCents: number;
    minParallelUnits: number;
    maxParallelUnits: number;
  })
  | (ListingVersionBase & {
    productCode: "MODEL_INSTANCE";
    rateUnitCode: "MODEL_INSTANCE";
    pricingUnitCode: "MODEL_INSTANCE_HOUR";
  })
  | (ListingVersionBase & {
    productCode: "TOKEN_THROUGHPUT";
    rateUnitCode: "MILLI_M_TOKEN_PER_HOUR";
    pricingUnitCode: "M_TOKEN_CAPACITY_HOUR";
  })
  | (ListingVersionBase & {
    productCode: "NAS_STORAGE";
    rateUnitCode: "GIB_STORAGE";
    pricingUnitCode: "TIB_HOUR";
  })
  | (ListingVersionBase & {
    productCode: "RACK_SPACE";
    rateUnitCode: "RACK";
    pricingUnitCode: "RACK_HOUR";
  });

export type MarketListing = ListingVersion & {
  resource: ResourceAsset;
  lot: CapacityLot;
  product: Pick<ProductVersion, "id" | "displayName" | "manufacturer" | "model" | "formFactor" | "specs">;
};

type ReservationBase = {
  id: string;
  orderId: string;
  capacityLotId: string;
  productCode: EnabledCapacityDescriptor["productCode"];
  rateUnitCode: EnabledCapacityDescriptor["rateUnitCode"];
  fulfillmentModel: EnabledCapacityDescriptor["fulfillmentModel"];
  pricingUnitCode: EnabledCapacityDescriptor["pricingUnitCode"];
  priceBasisBaseUnits: number;
  rateUnits: number;
  startAt: string;
  endAt: string;
  durationSeconds: number;
  capacityBaseUnits: number;
  state: "HELD" | "SUPPLIER_CONFIRMED" | "COMMITTED" | "IN_SERVICE" | "FULFILLED" | "EXPIRED" | "RELEASED" | "FAILED";
  holdExpiresAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type Reservation =
  | (ReservationBase & {
    productCode: "GPU_COMPUTE";
    rateUnitCode: "GPU";
    parallelUnits: number;
    capacityGpuSeconds: number;
    capacityGpuHours: number;
  })
  | (ReservationBase & { productCode: "MODEL_INSTANCE"; rateUnitCode: "MODEL_INSTANCE" })
  | (ReservationBase & { productCode: "TOKEN_THROUGHPUT"; rateUnitCode: "MILLI_M_TOKEN_PER_HOUR" })
  | (ReservationBase & { productCode: "NAS_STORAGE"; rateUnitCode: "GIB_STORAGE" })
  | (ReservationBase & { productCode: "RACK_SPACE"; rateUnitCode: "RACK" });

type ExchangeOrderBase = {
  id: string;
  buyerActorId: string;
  supplierActorId: string;
  listingVersionId: string;
  productCode: EnabledCapacityDescriptor["productCode"];
  rateUnitCode: EnabledCapacityDescriptor["rateUnitCode"];
  fulfillmentModel: EnabledCapacityDescriptor["fulfillmentModel"];
  pricingUnitCode: EnabledCapacityDescriptor["pricingUnitCode"];
  priceBasisBaseUnits: number;
  rateUnits: number;
  startAt: string;
  endAt: string;
  durationSeconds: number;
  capacityBaseUnits: number;
  unitPriceMicros: number;
  totalAmountCents: number;
  currency: "CNY";
  status: "PENDING_SUPPLIER_CONFIRMATION" | "AWAITING_PAYMENT" | "FULFILLING" | "AWAITING_ACCEPTANCE" | "COMPLETED" | "EXCEPTION" | "CANCELLED" | "EXPIRED";
  userPhase: "待确认" | "待支付" | "开通中" | "待验收" | "已完成" | "异常";
  holdExpiresAt: string;
  version: number;
  allowedActions: readonly string[];
  createdAt: string;
  updatedAt: string;
  reservation: Reservation;
  payment: PaymentIntent | null;
  delivery: DeliveryTask | null;
  metering: MeteringSession | null;
  acceptance: OrderAcceptance | null;
  settlement: TestSettlement | null;
  referralDecision: ReferralDecision;
  referralAttribution: ReferralAttribution | null;
};

export type ExchangeOrder =
  | (ExchangeOrderBase & {
    productCode: "GPU_COMPUTE";
    rateUnitCode: "GPU";
    pricingUnitCode: "GPU_HOUR";
    parallelUnits: number;
    capacityGpuSeconds: number;
    capacityGpuHours: number;
    unitPriceCents: number;
    reservation: Extract<Reservation, { productCode: "GPU_COMPUTE" }>;
  })
  | (ExchangeOrderBase & {
    productCode: "MODEL_INSTANCE";
    rateUnitCode: "MODEL_INSTANCE";
    pricingUnitCode: "MODEL_INSTANCE_HOUR";
    reservation: Extract<Reservation, { productCode: "MODEL_INSTANCE" }>;
  })
  | (ExchangeOrderBase & {
    productCode: "TOKEN_THROUGHPUT";
    rateUnitCode: "MILLI_M_TOKEN_PER_HOUR";
    pricingUnitCode: "M_TOKEN_CAPACITY_HOUR";
    reservation: Extract<Reservation, { productCode: "TOKEN_THROUGHPUT" }>;
  })
  | (ExchangeOrderBase & {
    productCode: "NAS_STORAGE";
    rateUnitCode: "GIB_STORAGE";
    pricingUnitCode: "TIB_HOUR";
    reservation: Extract<Reservation, { productCode: "NAS_STORAGE" }>;
  })
  | (ExchangeOrderBase & {
    productCode: "RACK_SPACE";
    rateUnitCode: "RACK";
    pricingUnitCode: "RACK_HOUR";
    reservation: Extract<Reservation, { productCode: "RACK_SPACE" }>;
  });

type MeteringSessionBase = {
  id: string;
  orderId: string;
  productCode: EnabledCapacityDescriptor["productCode"];
  rateUnitCode: EnabledCapacityDescriptor["rateUnitCode"];
  fulfillmentModel: EnabledCapacityDescriptor["fulfillmentModel"];
  pricingUnitCode: EnabledCapacityDescriptor["pricingUnitCode"];
  priceBasisBaseUnits: number;
  environment: "TEST";
  status: "SCHEDULED" | "ACTIVE" | "FINAL";
  scheduledStartAt: string;
  scheduledEndAt: string;
  actualStartAt: string | null;
  finalizedAt: string | null;
  scheduledCapacityBaseUnits: number;
  availableCapacityBaseUnits: number;
  unavailableCapacityBaseUnits: number;
  unprovenCapacityBaseUnits: number;
  availabilityPpm: number | null;
  version: number;
  allowedActions: readonly string[];
  createdAt: string;
  updatedAt: string;
};

export type MeteringSession =
  | (MeteringSessionBase & {
    productCode: "GPU_COMPUTE";
    rateUnitCode: "GPU";
    scheduledGpuSeconds: number;
    availableGpuSeconds: number;
    unavailableGpuSeconds: number;
    unprovenGpuSeconds: number;
  })
  | (MeteringSessionBase & { productCode: "MODEL_INSTANCE"; rateUnitCode: "MODEL_INSTANCE" })
  | (MeteringSessionBase & { productCode: "TOKEN_THROUGHPUT"; rateUnitCode: "MILLI_M_TOKEN_PER_HOUR" })
  | (MeteringSessionBase & { productCode: "NAS_STORAGE"; rateUnitCode: "GIB_STORAGE" })
  | (MeteringSessionBase & { productCode: "RACK_SPACE"; rateUnitCode: "RACK" });

export type OrderAcceptance = {
  id: string;
  orderId: string;
  status: "PENDING" | "ACCEPTED" | "DISPUTED";
  reason: string | null;
  evidenceDigest: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TestSettlement = {
  id: string;
  orderId: string;
  environment: "TEST";
  status: "BLOCKED" | "ELIGIBLE" | "TEST_RECORDED";
  grossAmountCents: number;
  baseCreditCents: number;
  disputeCreditCents: number;
  netSupplierPayableCents: number;
  fundsMoved: false;
  ledgerBatchId: string | null;
  commission: CommissionAccrual | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CapacityWithdrawal = Readonly<{
  id: string;
  capacityLotId: string;
  supplierActorId: string;
  transferId: string;
  rateUnitCode: RateUnitCode;
  capacityBaseUnits: number;
  reason: string;
  occurredAt: string;
}>;

export type SwapQuoteStatus = "QUOTED" | "OPS_REVIEW" | "CANCELLED" | "EXPIRED";

export type SwapQuoteLegSnapshot = Readonly<{
  id: string;
  quoteId: string;
  legRole: "OFFERED" | "WANTED";
  sourceListingVersionId: string;
  listingCreatedAt: string;
  listingValidFrom: string;
  productVersionId: string;
  capacityPolicyId: string;
  productCode: EnabledCapacityDescriptor["productCode"];
  rateUnitCode: EnabledCapacityDescriptor["rateUnitCode"];
  fulfillmentModel: EnabledCapacityDescriptor["fulfillmentModel"];
  pricingUnitCode: EnabledCapacityDescriptor["pricingUnitCode"];
  rateUnits: number;
  startAt: string;
  endAt: string;
  durationSeconds: number;
  capacityBaseUnits: number;
  unitPriceMicros: number;
  priceBasisBaseUnits: number;
  valueCents: number;
  currency: "CNY";
  generatedAt: string;
  expiresAt: string;
  snapshotDigest: string;
}>;

export type SwapQuote = Readonly<{
  id: string;
  initiatorActorId: string;
  counterpartyActorId: string;
  offered: SwapQuoteLegSnapshot;
  wanted: SwapQuoteLegSnapshot;
  offeredValueCents: number;
  wantedValueCents: number;
  cashAdjustmentSignedCents: number;
  cashAdjustmentAmountCents: number;
  cashAdjustmentPayerActorId: string | null;
  cashAdjustmentPayeeActorId: string | null;
  status: SwapQuoteStatus;
  allowedActions: ReadonlyArray<"OPS_REVIEW" | "CANCELLED" | "EXPIRED">;
  version: number;
  generatedAt: string;
  expiresAt: string;
  quoteDigest: string;
}>;

export type ReferralCode = Readonly<{
  id: string;
  agentActorId: string;
  code: string;
  createdAt: string;
}>;

export type ReferralDecision = Readonly<{
  id: string;
  orderId: string;
  outcome: "NONE" | "INVALID" | "SELF_BUYER" | "SELF_SUPPLIER" | "APPLIED";
  resolvedCodeId: string | null;
  submittedCodeDigest: string | null;
  decidedAt: string;
}>;

export type ReferralAttribution = Readonly<{
  id: string;
  orderId: string;
  decisionId: string;
  referralCodeId: string;
  agentActorId: string;
  buyerActorId: string;
  supplierActorId: string;
  attributedAt: string;
}>;

export type ReferralResolution = Readonly<{
  resolvedCodeId: string | null;
  submittedCodeDigest: string | null;
}>;

export type CommissionAccrual = Readonly<{
  id: string;
  orderId: string;
  settlementId: string;
  attributionId: string;
  agentActorId: string;
  environment: "TEST";
  recordKind: "ESTIMATE_ONLY";
  commissionBaseCents: number;
  commissionRateBasisPoints: 300;
  commissionEstimateCents: number;
  fundsMoved: false;
  createdAt: string;
}>;

export type PaymentIntent = {
  id: string;
  orderId: string;
  provider: string;
  environment: "TEST" | "LIVE";
  merchantAccountRef: string;
  amountCents: number;
  currency: "CNY";
  status: "PENDING" | "CAPTURED" | "FAILED" | "EXPIRED" | "REFUND_PENDING" | "REFUNDED";
  providerPaymentId: string | null;
  expiresAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryTask = {
  id: string;
  orderId: string;
  method: "MANUAL" | "CONNECTOR";
  status: "PENDING" | "PROVISIONING" | "VERIFYING" | "DELIVERED" | "IN_SERVICE" | "COMPLETED" | "FAILED";
  package: DeliveryPackage | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryPublicProfile = {
  protocol: "SSH" | "HTTPS" | "JUPYTER" | "RDP" | "NFS" | "WORK_ORDER" | "OTHER";
  endpointDisplay: string;
  port: number;
  usernameHint: string;
  region: string;
  deliveryForm: string;
  credentialKind: "ONE_TIME_TEST_CODE";
  expiresAt: string;
  instructionsSummary: string;
};

export type DeliveryReview = {
  id: string;
  packageId: string;
  reviewerActorId: string;
  decision: "PASS" | "REJECT";
  verificationMethod: "MANUAL" | "SIMULATED_TEST";
  reason: string;
  evidenceDigest: string;
  createdAt: string;
};

export type DeliveryClaim = {
  id: string;
  packageId: string;
  buyerActorId: string;
  claimedAt: string;
};

export type ConnectionCheck = {
  id: string;
  packageId: string;
  buyerActorId: string;
  adapter: "SIMULATED_TEST";
  status: "RUNNING" | "PASSED" | "FAILED";
  diagnosticCode: string;
  summary: string;
  evidenceDigest: string;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
};

export type DeliveryPackage = {
  id: string;
  deliveryTaskId: string;
  orderId: string;
  supplierActorId: string;
  revision: number;
  environment: "TEST";
  status: "SUBMITTED" | "VERIFIED" | "REJECTED" | "CLAIMED" | "EXPIRED" | "REVOKED";
  publicProfile: DeliveryPublicProfile;
  submissionEvidenceDigest: string;
  review: DeliveryReview | null;
  claim: DeliveryClaim | null;
  latestConnectionCheck: ConnectionCheck | null;
  allowedActions: readonly string[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateCheckout = {
  listingVersionId: string;
  rateUnits: number;
  startAt: string;
  endAt: string;
  interruptibility: Interruptibility;
};

export type WithdrawCapacityLot = {
  expectedVersion: number;
  reason: string;
};

export type SwapQuoteLegInput = {
  listingVersionId: string;
  rateUnits: number;
  startAt: string;
  endAt: string;
};

export type CreateSwapQuote = {
  offered: SwapQuoteLegInput;
  wanted: SwapQuoteLegInput;
};

export type TransitionSwapQuote = {
  expectedVersion: number;
  action: "OPS_REVIEW" | "CANCELLED" | "EXPIRED";
  reason: string;
};

export type GenerateReferralCode = Record<string, never>;

export type SupplierConfirmation = {
  action: "CONFIRM" | "REJECT";
  expectedVersion: number;
  reason: string;
};

export type ApplyPaymentEvent = {
  provider: string;
  environment: "TEST" | "LIVE";
  providerEventId: string;
  providerTransactionId: string;
  providerOrderId: string;
  merchantAccountRef: string;
  eventType: "CAPTURED";
  amountCents: number;
  currency: "CNY";
  occurredAt: string;
  rawPayloadDigest: string;
  verificationMethod: string;
  verifiedAt: string;
  fundsMoved: boolean;
};

export type TestPaymentRequest = { expectedVersion: number };
export type StartProvisioning = { expectedVersion: number; reason: string };
export type SubmitDeliveryPackage = {
  expectedVersion: number;
  publicProfile: Pick<
    DeliveryPublicProfile,
    "protocol" | "endpointDisplay" | "port" | "usernameHint" | "expiresAt" | "instructionsSummary"
  >;
  evidenceDigest: string;
};
export type ReviewDeliveryPackage = {
  expectedVersion: number;
  decision: DeliveryReview["decision"];
  verificationMethod: DeliveryReview["verificationMethod"];
  reason: string;
  evidenceDigest: string;
};
export type ClaimDeliveryPackage = { expectedVersion: number };
export type ClaimDeliveryPackageResult = { package: DeliveryPackage; testCode: string };
export type TestDeliveryConnection = { expectedVersion: number };
export type TestServiceStart = { expectedVersion: number };
export type TestMeterComplete = { expectedVersion: number };
export type SubmitOrderAcceptance = {
  expectedVersion: number;
  decision: "ACCEPT" | "DISPUTE";
  reason: string;
  evidenceDigest: string;
};
export type TestRecordSettlement = { expectedVersion: number };

export type CreateResourceAsset = {
  productVersionId: string;
  title: string;
  region: string;
  deliveryForm: string;
  totalRateUnits: number;
  interruptibility: Interruptibility;
  networkScope: string;
};

export type CreateVerificationRun = {
  method: VerificationRun["method"];
  result: VerificationRun["result"];
  evidenceSummary: string;
  evidenceDigest: string;
  validUntil: string | null;
};

export type CreateCapacityLot = {
  resourceAssetId: string;
  verificationRunId?: string;
  startAt: string;
  endAt: string;
  rateUnits: number;
  interruptibility: Interruptibility;
};

export type CreateListingVersion = {
  capacityLotId: string;
  expectedLotVersion: number;
  unitPriceMicros: number;
  minRateUnits: number;
  maxRateUnits: number;
  minDurationMinutes: number;
  taxIncluded: boolean;
  energyIncluded: boolean;
  networkIncluded: boolean;
  scopeNote: string;
  sla: ListingVersion["sla"];
  deliveryForm: string;
  validFrom: string;
  validUntil: string;
};

function objectValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExchangeInputError("请求内容必须是对象。");
  }
  return value as Record<string, unknown>;
}

function onlyKeys(input: Record<string, unknown>, allowed: readonly string[]) {
  const unexpected = Object.keys(input).find((key) => !allowed.includes(key));
  if (unexpected) throw new ExchangeInputError(`${unexpected} 不是支持字段。`, unexpected);
}

const legacyGpuCreateInputs = new WeakSet<object>();

export function isLegacyGpuCreateInput(value: object) {
  return legacyGpuCreateInputs.has(value);
}

function stringValue(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== "string") throw new ExchangeInputError(`${field} 格式不正确。`, field);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < min || normalized.length > max) {
    throw new ExchangeInputError(`${field} 长度应为 ${min}–${max} 个字符。`, field);
  }
  if (/[\u0000-\u001F\u007F]/u.test(normalized)) {
    throw new ExchangeInputError(`${field} 包含不支持的控制字符。`, field);
  }
  return normalized;
}

function sha256DigestValue(value: unknown, field: string) {
  const normalized = stringValue(value, field, 71, 71).toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/u.test(normalized)) {
    throw new ExchangeInputError(`${field} 必须是 sha256: 加 64 位十六进制摘要。`, field);
  }
  return normalized;
}

function containsSecretMaterial(value: string) {
  return /-----BEGIN [^-]*PRIVATE KEY-----|(?:password|passwd|token|api[_ -]?key|secret)\s*[:=]/iu.test(value);
}

function integerValue(value: unknown, field: string, min: number, max: number) {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ExchangeInputError(`${field} 必须是 ${min}–${max} 的整数。`, field);
  }
  return value as number;
}

function canonicalOrLegacyInteger(
  input: Record<string, unknown>,
  canonicalField: string,
  legacyField: string,
  min: number,
  max: number,
) {
  if (input[canonicalField] !== undefined && input[legacyField] !== undefined) {
    throw new ExchangeInputError(`${canonicalField} 与 ${legacyField} 不能同时提交。`, canonicalField);
  }
  if (input[canonicalField] !== undefined) return integerValue(input[canonicalField], canonicalField, min, max);
  return integerValue(input[legacyField], legacyField, min, max);
}

function booleanValue(value: unknown, field: string) {
  if (typeof value !== "boolean") throw new ExchangeInputError(`${field} 必须是布尔值。`, field);
  return value;
}

function enumValue<const T extends readonly string[]>(value: unknown, field: string, values: T): T[number] {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    throw new ExchangeInputError(`${field} 不在支持范围内。`, field);
  }
  return value as T[number];
}

function utcInstant(value: unknown, field: string) {
  const normalized = stringValue(value, field, 20, 30);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(normalized)) {
    throw new ExchangeInputError(`${field} 必须是 UTC 时间。`, field);
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new ExchangeInputError(`${field} 不是有效时间。`, field);
  return new Date(timestamp).toISOString();
}

export function parseCreateResourceAsset(value: unknown): CreateResourceAsset {
  const input = objectValue(value);
  onlyKeys(input, [
    "productVersionId", "title", "region", "deliveryForm", "totalRateUnits", "totalParallelUnits",
    "interruptibility", "networkScope",
  ]);
  const result: CreateResourceAsset = {
    productVersionId: stringValue(input.productVersionId, "productVersionId", 8, 80),
    title: stringValue(input.title, "title", 4, 100),
    region: stringValue(input.region, "region", 2, 40),
    deliveryForm: stringValue(input.deliveryForm, "deliveryForm", 2, 60),
    totalRateUnits: canonicalOrLegacyInteger(input, "totalRateUnits", "totalParallelUnits", 1, 100_000),
    interruptibility: enumValue(input.interruptibility, "interruptibility", ["NON_INTERRUPTIBLE", "INTERRUPTIBLE"] as const),
    networkScope: stringValue(input.networkScope, "networkScope", 4, 500),
  };
  if (input.totalParallelUnits !== undefined) legacyGpuCreateInputs.add(result);
  return result;
}

export function parseCreateVerificationRun(value: unknown): CreateVerificationRun {
  const input = objectValue(value);
  onlyKeys(input, ["method", "result", "evidenceSummary", "evidenceDigest", "validUntil"]);
  const verificationResult = enumValue(input.result, "result", ["PASS", "FAIL"] as const);
  const validUntil = input.validUntil === null || input.validUntil === undefined ? null : utcInstant(input.validUntil, "validUntil");
  if (verificationResult === "PASS" && (!validUntil || Date.parse(validUntil) <= Date.now())) {
    throw new ExchangeInputError("通过验真的有效期必须晚于当前时间。", "validUntil");
  }
  return {
    method: enumValue(input.method, "method", ["MANUAL", "CONNECTOR", "CLOUD_API"] as const),
    result: verificationResult,
    evidenceSummary: stringValue(input.evidenceSummary, "evidenceSummary", 8, 1_000),
    evidenceDigest: stringValue(input.evidenceDigest, "evidenceDigest", 16, 128),
    validUntil: verificationResult === "PASS" ? validUntil : null,
  };
}

export function parseCreateCapacityLot(value: unknown): CreateCapacityLot {
  const input = objectValue(value);
  onlyKeys(input, [
    "resourceAssetId", "verificationRunId", "startAt", "endAt", "rateUnits", "parallelUnits", "interruptibility",
  ]);
  const startAt = utcInstant(input.startAt, "startAt");
  const endAt = utcInstant(input.endAt, "endAt");
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (end <= start) throw new ExchangeInputError("endAt 必须晚于 startAt。", "endAt");
  if (end - start > 366 * 24 * 60 * 60 * 1_000) {
    throw new ExchangeInputError("单个容量批次不能超过 366 天。", "endAt");
  }
  if (start % 1_000 !== 0 || end % 1_000 !== 0) {
    throw new ExchangeInputError("容量时间窗必须精确到整秒。", "startAt");
  }
  const rateUnits = canonicalOrLegacyInteger(input, "rateUnits", "parallelUnits", 1, 100_000);
  const durationSeconds = (end - start) / 1_000;
  const capacityBaseUnits = deriveCapacityBaseUnits(BigInt(rateUnits), BigInt(durationSeconds));
  if (capacityBaseUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ExchangeInputError("容量超过平台可安全处理的整数上限。", "rateUnits");
  }
  const result: CreateCapacityLot = {
    resourceAssetId: stringValue(input.resourceAssetId, "resourceAssetId", 8, 80),
    verificationRunId: input.verificationRunId === undefined || input.verificationRunId === null
      ? undefined
      : stringValue(input.verificationRunId, "verificationRunId", 8, 80),
    startAt,
    endAt,
    rateUnits,
    interruptibility: enumValue(input.interruptibility, "interruptibility", ["NON_INTERRUPTIBLE", "INTERRUPTIBLE"] as const),
  };
  if (input.parallelUnits !== undefined) legacyGpuCreateInputs.add(result);
  return result;
}

export function parseCreateListingVersion(value: unknown): CreateListingVersion {
  const input = objectValue(value);
  onlyKeys(input, [
    "capacityLotId", "expectedLotVersion", "unitPriceMicros", "unitPriceCents", "minRateUnits", "maxRateUnits",
    "minParallelUnits", "maxParallelUnits", "minDurationMinutes", "taxIncluded", "energyIncluded",
    "networkIncluded", "scopeNote", "sla", "deliveryForm", "validFrom", "validUntil",
  ]);
  const validFrom = utcInstant(input.validFrom, "validFrom");
  const validUntil = utcInstant(input.validUntil, "validUntil");
  if (validUntil <= validFrom) throw new ExchangeInputError("validUntil 必须晚于 validFrom。", "validUntil");
  const canonicalRates = input.minRateUnits !== undefined || input.maxRateUnits !== undefined;
  const legacyRates = input.minParallelUnits !== undefined || input.maxParallelUnits !== undefined;
  if (canonicalRates && legacyRates) {
    throw new ExchangeInputError("min/maxRateUnits 与 min/maxParallelUnits 不能同时提交。", "minRateUnits");
  }
  const minRateUnits = canonicalRates
    ? integerValue(input.minRateUnits, "minRateUnits", 1, 100_000)
    : integerValue(input.minParallelUnits, "minParallelUnits", 1, 100_000);
  const maxRateUnits = canonicalRates
    ? integerValue(input.maxRateUnits, "maxRateUnits", 1, 100_000)
    : integerValue(input.maxParallelUnits, "maxParallelUnits", 1, 100_000);
  if (maxRateUnits < minRateUnits) {
    throw new ExchangeInputError("maxRateUnits 不能小于 minRateUnits。", "maxRateUnits");
  }
  const slaInput = objectValue(input.sla);
  onlyKeys(slaInput, ["availabilityPercent", "responseMinutes"]);
  const availabilityPercent = Number(slaInput.availabilityPercent);
  if (!Number.isFinite(availabilityPercent) || availabilityPercent < 90 || availabilityPercent > 100) {
    throw new ExchangeInputError("sla.availabilityPercent 应在 90–100 之间。", "sla.availabilityPercent");
  }
  const result: CreateListingVersion = {
    capacityLotId: stringValue(input.capacityLotId, "capacityLotId", 8, 80),
    expectedLotVersion: integerValue(input.expectedLotVersion, "expectedLotVersion", 1, 1_000_000_000),
    unitPriceMicros: input.unitPriceMicros !== undefined
      ? (() => {
        if (input.unitPriceCents !== undefined) {
          throw new ExchangeInputError("unitPriceMicros 与 unitPriceCents 不能同时提交。", "unitPriceMicros");
        }
        return integerValue(input.unitPriceMicros, "unitPriceMicros", 1, Number.MAX_SAFE_INTEGER);
      })()
      : integerValue(input.unitPriceCents, "unitPriceCents", 1, 1_000_000_000) * 10_000,
    minRateUnits,
    maxRateUnits,
    minDurationMinutes: integerValue(input.minDurationMinutes, "minDurationMinutes", 1, 527_040),
    taxIncluded: booleanValue(input.taxIncluded, "taxIncluded"),
    energyIncluded: booleanValue(input.energyIncluded, "energyIncluded"),
    networkIncluded: booleanValue(input.networkIncluded, "networkIncluded"),
    scopeNote: stringValue(input.scopeNote, "scopeNote", 8, 1_000),
    sla: {
      availabilityPercent,
      responseMinutes: integerValue(slaInput.responseMinutes, "sla.responseMinutes", 1, 43_200),
    },
    deliveryForm: stringValue(input.deliveryForm, "deliveryForm", 2, 60),
    validFrom,
    validUntil,
  };
  if (legacyRates || input.unitPriceCents !== undefined) legacyGpuCreateInputs.add(result);
  return result;
}

export function parseWithdrawCapacityLot(value: unknown): WithdrawCapacityLot {
  const input = objectValue(value);
  onlyKeys(input, ["expectedVersion", "reason"]);
  return {
    expectedVersion: integerValue(input.expectedVersion, "expectedVersion", 1, 1_000_000_000),
    reason: stringValue(input.reason, "reason", 4, 300),
  };
}

function parseSwapQuoteLeg(value: unknown, field: "offered" | "wanted"): SwapQuoteLegInput {
  const input = objectValue(value);
  onlyKeys(input, ["listingVersionId", "rateUnits", "startAt", "endAt"]);
  const startAt = utcInstant(input.startAt, `${field}.startAt`);
  const endAt = utcInstant(input.endAt, `${field}.endAt`);
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (end <= start) throw new ExchangeInputError(`${field}.endAt must be after startAt.`, `${field}.endAt`);
  if (start < Date.now() - 60_000) {
    throw new ExchangeInputError(`${field}.startAt cannot be in the past.`, `${field}.startAt`);
  }
  if (end - start > 366 * 24 * 60 * 60 * 1_000) {
    throw new ExchangeInputError(`${field} cannot exceed 366 days.`, `${field}.endAt`);
  }
  if (start % 1_000 !== 0 || end % 1_000 !== 0) {
    throw new ExchangeInputError(`${field} must use whole UTC seconds.`, `${field}.startAt`);
  }
  return {
    listingVersionId: stringValue(input.listingVersionId, `${field}.listingVersionId`, 8, 100),
    rateUnits: integerValue(input.rateUnits, `${field}.rateUnits`, 1, 100_000),
    startAt,
    endAt,
  };
}

export function parseCreateSwapQuote(value: unknown): CreateSwapQuote {
  const input = objectValue(value);
  onlyKeys(input, ["offered", "wanted"]);
  return {
    offered: parseSwapQuoteLeg(input.offered, "offered"),
    wanted: parseSwapQuoteLeg(input.wanted, "wanted"),
  };
}

export function parseTransitionSwapQuote(value: unknown): TransitionSwapQuote {
  const input = objectValue(value);
  onlyKeys(input, ["expectedVersion", "action", "reason"]);
  return {
    expectedVersion: integerValue(input.expectedVersion, "expectedVersion", 1, 1_000_000_000),
    action: enumValue(input.action, "action", ["OPS_REVIEW", "CANCELLED", "EXPIRED"] as const),
    reason: stringValue(input.reason, "reason", 4, 500),
  };
}

export function parseGenerateReferralCode(value: unknown): GenerateReferralCode {
  const input = objectValue(value);
  onlyKeys(input, []);
  return {};
}

export function normalizeReferralCode(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = stringValue(value, "ref", 8, 40).toUpperCase();
  if (!/^[A-Z0-9-]+$/u.test(normalized)) throw new ExchangeInputError("ref format is invalid.", "ref");
  return normalized;
}

export function parseCreateCheckout(value: unknown): CreateCheckout {
  const input = objectValue(value);
  onlyKeys(input, ["listingVersionId", "rateUnits", "parallelUnits", "startAt", "endAt", "interruptibility"]);
  const startAt = utcInstant(input.startAt, "startAt");
  const endAt = utcInstant(input.endAt, "endAt");
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (end <= start) throw new ExchangeInputError("endAt 必须晚于 startAt。", "endAt");
  if (start < Date.now() - 60_000) throw new ExchangeInputError("服务开始时间不能早于当前时间。", "startAt");
  if (end - start > 366 * 24 * 60 * 60 * 1_000) throw new ExchangeInputError("单笔订单不能超过 366 天。", "endAt");
  if (start % 1_000 !== 0 || end % 1_000 !== 0) {
    throw new ExchangeInputError("订单时间窗必须精确到整秒。", "startAt");
  }
  const rateUnits = canonicalOrLegacyInteger(input, "rateUnits", "parallelUnits", 1, 100_000);
  const result: CreateCheckout = {
    listingVersionId: stringValue(input.listingVersionId, "listingVersionId", 8, 100),
    rateUnits,
    startAt,
    endAt,
    interruptibility: enumValue(input.interruptibility, "interruptibility", ["NON_INTERRUPTIBLE", "INTERRUPTIBLE"] as const),
  };
  if (input.parallelUnits !== undefined) legacyGpuCreateInputs.add(result);
  return result;
}

export function parseSupplierConfirmation(value: unknown): SupplierConfirmation {
  const input = objectValue(value);
  onlyKeys(input, ["action", "expectedVersion", "reason"]);
  return {
    action: enumValue(input.action, "action", ["CONFIRM", "REJECT"] as const),
    expectedVersion: integerValue(input.expectedVersion, "expectedVersion", 1, 1_000_000_000),
    reason: stringValue(input.reason, "reason", 4, 500),
  };
}

export function parsePaymentEvent(value: unknown): ApplyPaymentEvent {
  const input = objectValue(value);
  onlyKeys(input, [
    "provider", "environment", "providerEventId", "providerTransactionId", "providerOrderId",
    "merchantAccountRef", "eventType", "amountCents", "currency", "occurredAt", "rawPayloadDigest",
    "verificationMethod", "verifiedAt", "fundsMoved",
  ]);
  return {
    provider: stringValue(input.provider, "provider", 2, 40),
    environment: enumValue(input.environment, "environment", ["TEST", "LIVE"] as const),
    providerEventId: stringValue(input.providerEventId, "providerEventId", 8, 128),
    providerTransactionId: stringValue(input.providerTransactionId, "providerTransactionId", 8, 128),
    providerOrderId: stringValue(input.providerOrderId, "providerOrderId", 8, 100),
    merchantAccountRef: stringValue(input.merchantAccountRef, "merchantAccountRef", 4, 100),
    eventType: enumValue(input.eventType, "eventType", ["CAPTURED"] as const),
    amountCents: integerValue(input.amountCents, "amountCents", 1, Number.MAX_SAFE_INTEGER),
    currency: enumValue(input.currency, "currency", ["CNY"] as const),
    occurredAt: utcInstant(input.occurredAt, "occurredAt"),
    rawPayloadDigest: stringValue(input.rawPayloadDigest, "rawPayloadDigest", 16, 128),
    verificationMethod: stringValue(input.verificationMethod, "verificationMethod", 4, 80),
    verifiedAt: utcInstant(input.verifiedAt, "verifiedAt"),
    fundsMoved: booleanValue(input.fundsMoved, "fundsMoved"),
  };
}

export function parseTestPaymentRequest(value: unknown): TestPaymentRequest {
  const input = objectValue(value);
  onlyKeys(input, ["expectedVersion"]);
  return { expectedVersion: integerValue(input.expectedVersion, "expectedVersion", 1, 1_000_000_000) };
}

export function parseStartProvisioning(value: unknown): StartProvisioning {
  const input = objectValue(value);
  onlyKeys(input, ["expectedVersion", "reason"]);
  return {
    expectedVersion: integerValue(input.expectedVersion, "expectedVersion", 1, 1_000_000_000),
    reason: stringValue(input.reason, "reason", 4, 500),
  };
}

export function parseSubmitDeliveryPackage(value: unknown): SubmitDeliveryPackage {
  const input = objectValue(value);
  onlyKeys(input, ["expectedVersion", "publicProfile", "evidenceDigest"]);
  const profile = objectValue(input.publicProfile);
  onlyKeys(profile, ["protocol", "endpointDisplay", "port", "usernameHint", "expiresAt", "instructionsSummary"]);
  const endpointDisplay = stringValue(profile.endpointDisplay, "publicProfile.endpointDisplay", 4, 160);
  if (!endpointDisplay.includes("*")) {
    throw new ExchangeInputError("publicProfile.endpointDisplay 必须是含 * 的脱敏展示值。", "publicProfile.endpointDisplay");
  }
  const usernameHint = stringValue(profile.usernameHint, "publicProfile.usernameHint", 1, 80);
  const instructionsSummary = stringValue(profile.instructionsSummary, "publicProfile.instructionsSummary", 8, 500);
  if (containsSecretMaterial(`${endpointDisplay}\n${usernameHint}\n${instructionsSummary}`)) {
    throw new ExchangeInputError("公开连接档案不能包含密码、私钥、Token 或密钥。", "publicProfile");
  }
  const expiresAt = utcInstant(profile.expiresAt, "publicProfile.expiresAt");
  if (Date.parse(expiresAt) <= Date.now()) {
    throw new ExchangeInputError("测试连接信息有效期必须晚于当前时间。", "publicProfile.expiresAt");
  }
  return {
    expectedVersion: integerValue(input.expectedVersion, "expectedVersion", 1, 1_000_000_000),
    publicProfile: {
      protocol: enumValue(
        profile.protocol,
        "publicProfile.protocol",
        ["SSH", "HTTPS", "JUPYTER", "RDP", "NFS", "WORK_ORDER", "OTHER"] as const,
      ),
      endpointDisplay,
      port: integerValue(profile.port, "publicProfile.port", 1, 65_535),
      usernameHint,
      expiresAt,
      instructionsSummary,
    },
    evidenceDigest: sha256DigestValue(input.evidenceDigest, "evidenceDigest"),
  };
}

export function parseReviewDeliveryPackage(value: unknown): ReviewDeliveryPackage {
  const input = objectValue(value);
  onlyKeys(input, ["expectedVersion", "decision", "verificationMethod", "reason", "evidenceDigest"]);
  const reason = stringValue(input.reason, "reason", 4, 500);
  if (containsSecretMaterial(reason)) {
    throw new ExchangeInputError("核验说明不能包含密码、私钥、Token 或密钥。", "reason");
  }
  return {
    expectedVersion: integerValue(input.expectedVersion, "expectedVersion", 1, 1_000_000_000),
    decision: enumValue(input.decision, "decision", ["PASS", "REJECT"] as const),
    verificationMethod: enumValue(input.verificationMethod, "verificationMethod", ["MANUAL", "SIMULATED_TEST"] as const),
    reason,
    evidenceDigest: sha256DigestValue(input.evidenceDigest, "evidenceDigest"),
  };
}

export function parseClaimDeliveryPackage(value: unknown): ClaimDeliveryPackage {
  const input = objectValue(value);
  onlyKeys(input, ["expectedVersion"]);
  return { expectedVersion: integerValue(input.expectedVersion, "expectedVersion", 1, 1_000_000_000) };
}

export function parseTestDeliveryConnection(value: unknown): TestDeliveryConnection {
  const input = objectValue(value);
  onlyKeys(input, ["expectedVersion"]);
  return { expectedVersion: integerValue(input.expectedVersion, "expectedVersion", 1, 1_000_000_000) };
}

export function parseTestServiceStart(value: unknown): TestServiceStart {
  const input = objectValue(value);
  onlyKeys(input, ["expectedVersion"]);
  return { expectedVersion: integerValue(input.expectedVersion, "expectedVersion", 1, 1_000_000_000) };
}

export function parseTestMeterComplete(value: unknown): TestMeterComplete {
  const input = objectValue(value);
  onlyKeys(input, ["expectedVersion"]);
  return { expectedVersion: integerValue(input.expectedVersion, "expectedVersion", 1, 1_000_000_000) };
}

export function parseSubmitOrderAcceptance(value: unknown): SubmitOrderAcceptance {
  const input = objectValue(value);
  onlyKeys(input, ["expectedVersion", "decision", "reason", "evidenceDigest"]);
  return {
    expectedVersion: integerValue(input.expectedVersion, "expectedVersion", 1, 1_000_000_000),
    decision: enumValue(input.decision, "decision", ["ACCEPT", "DISPUTE"] as const),
    reason: stringValue(input.reason, "reason", 4, 500),
    evidenceDigest: sha256DigestValue(input.evidenceDigest, "evidenceDigest"),
  };
}

export function parseTestRecordSettlement(value: unknown): TestRecordSettlement {
  const input = objectValue(value);
  onlyKeys(input, ["expectedVersion"]);
  return { expectedVersion: integerValue(input.expectedVersion, "expectedVersion", 1, 1_000_000_000) };
}

export function createExchangeId(prefix: "RA" | "VR" | "LOT" | "L" | "LV" | "ORD" | "RSV" | "CT" | "EV" | "PI" | "PE" | "DT" | "DP" | "DR" | "DC" | "CC" | "MS" | "SF" | "MF" | "AC" | "ST" | "LB" | "LE" | "OCS" | "MI" | "ME" | "WD" | "SQ" | "SQS" | "SQE" | "RC" | "RD" | "RAT" | "CA") {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const random = crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase();
  return `KAI-${prefix}-${date}-${random}`;
}

export function gpuHoursFromSeconds(capacityGpuSeconds: number) {
  return capacityGpuSeconds / 3_600;
}
