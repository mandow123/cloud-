"use client";

import {
  createIdempotencyKey,
  exchangeGet,
  exchangePost,
  MarketplaceApiError,
} from "@/lib/client/marketplace-client";

export type SupplyAssetKind = "H100_8X_NODE" | "MAC_MINI" | "GENERAL_SERVER";

export type SupplySupplierType = "INDIVIDUAL" | "COMPANY" | "IDC" | "CLOUD_VENDOR";

export type SupplyResourceType =
  | "GPU_CARD"
  | "GPU_SERVER"
  | "CPU_SERVER"
  | "MAC_COMPUTE"
  | "TOKEN_CAPACITY"
  | "MODEL_INSTANCE"
  | "NAS_STORAGE"
  | "RACK_CAPACITY"
  | "CLOUD_RESOURCE";

export type SupplyQuantityUnit = "CARD" | "NODE" | "SERVER" | "M_TOKENS_PER_HOUR" | "MODEL_INSTANCE" | "TIB" | "RACK" | "KW" | "QUOTA_UNIT";
export type SupplyPricingUnit = "CARD_HOUR" | "NODE_HOUR" | "SERVER_HOUR" | "TOKEN_CAPACITY_HOUR" | "MODEL_INSTANCE_HOUR" | "TIB_HOUR" | "RACK_MONTH" | "KW_MONTH" | "QUOTA_HOUR";

export type SupplyOfferInput = {
  supplierType: SupplySupplierType;
  resourceType: SupplyResourceType;
  productName: string;
  specification: string;
  quantity: number;
  quantityUnit: SupplyQuantityUnit;
  pricingUnit: SupplyPricingUnit;
  region: string;
  deliveryForm: string;
  availabilityStartAt?: string;
  availabilityEndAt?: string;
  notes: string | null;
};

export type SupplyOffer = Omit<SupplyOfferInput, "availabilityStartAt" | "availabilityEndAt"> & {
  id: string;
  supplierActorId: string;
  availabilityStartAt: string | null;
  availabilityEndAt: string | null;
  status: "DRAFT" | "SUBMITTED" | "UNDER_VERIFICATION" | "VERIFIED" | "REJECTED" | "PUBLISHED";
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SupplyPolicy = {
  poolId: string;
  publicationMode: "H100_LIMITED_TRIAL" | "INVENTORY_ONLY";
  unitPriceMicrosPerGpuHour: number | null;
  gpuCountPerNode: number | null;
  maxOrderHours: number;
  maxBuyerNodeHours: number;
  maxTotalNodeHours: number;
  sshExclusiveRequired: boolean;
};

export type SupplyPool = {
  id: string;
  supplierActorId: string;
  externalRef: string;
  assetKind: SupplyAssetKind;
  name: string;
  region: string;
  deliveryForm: string;
  specDigest: string;
  status: "DRAFT" | "ACTIVE" | "SUSPENDED";
  createdAt: string;
  updatedAt: string;
  policy: SupplyPolicy;
  memberCount: number;
  verifiedCount: number;
};

export type SupplyMember = {
  id: string;
  poolId: string;
  supplierActorId: string;
  externalRef: string;
  serialDigest: string;
  hardwareUuidDigest: string | null;
  specDigest: string;
  status: "DECLARED" | "ONLINE" | "VERIFIED" | "REJECTED" | "SUSPENDED";
  lastSeenAt: string | null;
  verifiedUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupplyVerificationJob = {
  id: string;
  poolId: string;
  memberId: string;
  requestedBy: string;
  reviewedBy: string | null;
  status: "PENDING" | "PASSED" | "FAILED";
  validUntil: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type SupplyPublicationPlan = {
  id: string;
  poolId: string;
  memberId: string;
  availabilityWindowId: string;
  status: "ACTIVE" | "SUSPENDED" | "EXHAUSTED";
  unitPriceMicrosPerGpuHour: number;
  gpuCount: 8;
  startAt: string;
  endAt: string;
  nodeHours: number;
  createdAt: string;
};

export type SupplyTrialOrder = {
  id: string;
  promotionId: string;
  allocationBindingId: string;
  buyerActorId: string;
  supplierActorId: string;
  memberId: string;
  startAt: string;
  endAt: string;
  durationHours: number;
  gpuCount: 8;
  unitPriceMicrosPerGpuHour: 1_000_000;
  amountCents: number;
  currency: "CNY";
  status: "PAYMENT_PENDING" | "PAID" | "PROVISIONING" | "DELIVERED" | "IN_SERVICE" | "COMPLETED" | "FAILED" | "CANCELLED" | "REFUND_PENDING" | "REFUNDED";
  expiresAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SupplyOrderDetail = {
  order: SupplyTrialOrder;
  allocation: {
    id: string;
    promotionId: string;
    memberId: string;
    buyerActorId: string;
    trialOrderId: string;
    startAt: string;
    endAt: string;
    nodeHours: number;
    status: "RESERVED" | "LOCKED" | "IN_SERVICE" | "RELEASED" | "CANCELLED";
    createdAt: string;
    updatedAt: string;
  };
  payment: {
    orderId: string;
    status: "PENDING" | "CAPTURED" | "CLOSED" | "REFUND_PENDING" | "REFUNDED" | "FAILED";
    provider: string;
    providerOrderRef: string;
    providerTransactionRef: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
  } | null;
  paymentEvents: Array<{
    id: string;
    provider: string;
    eventType: string;
    outcome: "APPLIED" | "IGNORED" | "REJECTED";
    resultingStatus: string;
    occurredAt: string;
  }>;
  delivery: {
    orderId: string;
    status: "AWAITING_PAYMENT" | "AWAITING_KEY" | "PROVISIONING" | "READY" | "IN_SERVICE" | "CLEANING" | "COMPLETED" | "FAILED";
    buyerPublicKeyFingerprint: string | null;
    secureEndpointRef: string | null;
    hostKeyFingerprint: string | null;
    credentialExpiresAt: string | null;
    cleanupEvidenceDigest: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
  } | null;
  connectionChecks: Array<{
    id: string;
    status: "RUNNING" | "PASSED" | "FAILED";
    diagnosticCode: string;
    evidenceDigest: string | null;
    startedAt: string;
    finishedAt: string | null;
  }>;
  paymentReadiness?: SupplyDashboard["paymentReadiness"];
  sshReadiness?: {
    ready: boolean;
    blockers: string[];
  };
};

export type AlipayPaymentIntent = {
  record: NonNullable<SupplyOrderDetail["payment"]>;
  provider: "ALIPAY";
  environment: "LIVE";
  checkoutUrl: string;
  amountCents: number;
  currency: "CNY";
  expiresAt: string;
  replayed: boolean;
};

export type SshKeySubmission = {
  orderId: string;
  status: "READY";
  publicKeyFingerprint: string;
  hostKeyFingerprint: string;
  credentialExpiresAt: string;
  commandId: string;
};

export type SupplyDashboard = {
  pools: SupplyPool[];
  verificationJobs: SupplyVerificationJob[];
  publicationPlans: SupplyPublicationPlan[];
  orders: SupplyTrialOrder[];
  paymentReadiness: {
    provider: string;
    environment: string;
    ready: boolean;
    blockers: string[];
  };
  updatedAt: string | null;
};

export type SupplyPoolInput = {
  externalRef: string;
  assetKind: SupplyAssetKind;
  name: string;
  region: string;
  deliveryForm: string;
  specDigest: string;
};

export type SupplyMemberInput = {
  externalRef: string;
  serialDigest: string;
  hardwareUuidDigest: string | null;
  specDigest: string;
};

type RawPoolEnvelope = {
  pool: Omit<SupplyPool, "policy" | "memberCount" | "verifiedCount">;
  policy: SupplyPolicy;
  memberCount: number;
  verifiedCount: number;
};

type RawDashboard = {
  pools?: RawPoolEnvelope[];
  verificationJobs?: SupplyVerificationJob[];
  publicationPlans?: SupplyPublicationPlan[];
  promotions?: SupplyPublicationPlan[];
  listings?: SupplyPublicationPlan[];
  orders?: SupplyTrialOrder[];
  paymentReadiness?: SupplyDashboard["paymentReadiness"];
  updatedAt?: string | null;
};

function normalizePool(item: RawPoolEnvelope): SupplyPool {
  return { ...item.pool, policy: item.policy, memberCount: item.memberCount, verifiedCount: item.verifiedCount };
}

export async function sha256Digest(value: unknown) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function getSupplyDashboard() {
  const result = await exchangeGet<RawDashboard>("/api/v1/supply/dashboard", "supplier");
  return {
    pools: (result.pools ?? []).map(normalizePool),
    verificationJobs: result.verificationJobs ?? [],
    publicationPlans: result.publicationPlans ?? result.promotions ?? result.listings ?? [],
    orders: result.orders ?? [],
    paymentReadiness: result.paymentReadiness ?? {
      provider: "ALIPAY",
      environment: "LIVE",
      ready: false,
      blockers: ["支付宝 LIVE 配置和服务端支付凭据尚未确认"],
    },
    updatedAt: result.updatedAt ?? null,
  } satisfies SupplyDashboard;
}

export async function getSupplyOffers() {
  const result = await exchangeGet<{ items: SupplyOffer[]; count?: number } | SupplyOffer[]>(
    "/api/v1/supply/offers",
    "supplier",
  );
  return Array.isArray(result) ? result : result.items;
}

export function createSupplyOffer(
  input: SupplyOfferInput,
  idempotencyKey = createIdempotencyKey("supply-offer"),
) {
  return exchangePost<SupplyOffer>(
    "/api/v1/supply/offers",
    "supplier",
    input,
    idempotencyKey,
  );
}

export async function createSupplyPool(input: SupplyPoolInput, idempotencyKey = createIdempotencyKey("supply-pool")) {
  const result = await exchangePost<{ pool: RawPoolEnvelope["pool"]; policy: SupplyPolicy }>(
    "/api/v1/supply/pools",
    "supplier",
    input,
    idempotencyKey,
  );
  return {
    ...result,
    record: { ...result.record.pool, policy: result.record.policy, memberCount: 0, verifiedCount: 0 } satisfies SupplyPool,
  };
}

export function importSupplyMembers(
  poolId: string,
  items: SupplyMemberInput[],
  idempotencyKey = createIdempotencyKey("supply-members"),
) {
  return exchangePost<{ items: SupplyMember[] }>(
    `/api/v1/supply/pools/${encodeURIComponent(poolId)}/members-batch`,
    "supplier",
    { items },
    idempotencyKey,
    30_000,
  );
}

export type MacInventoryInput = {
  externalRef: string;
  serialDigest: string;
  hardwareUuidDigest: string | null;
  model: string;
  chip: string;
  memoryGiB: number;
  storageGiB: number;
  region: string;
  networkProfile: string;
  deliveryForm: string;
};

export function importMacInventory(
  items: MacInventoryInput[],
  idempotencyKey = createIdempotencyKey("mac-inventory"),
) {
  return exchangePost<{ groups: Array<{ pool: RawPoolEnvelope["pool"]; policy: SupplyPolicy; items: SupplyMember[] }> }>(
    "/api/v1/supply/mac-inventory/batch",
    "supplier",
    { items },
    idempotencyKey,
    30_000,
  );
}

export function createVerificationJob(memberId: string, idempotencyKey = createIdempotencyKey("supply-verification")) {
  return exchangePost<SupplyVerificationJob>(
    "/api/v1/supply/verification-jobs",
    "supplier",
    { memberId },
    idempotencyKey,
  );
}

export function createPublicationPlan(
  poolId: string,
  windowIds: string[],
  idempotencyKey = createIdempotencyKey("supply-publication"),
) {
  return exchangePost<SupplyPublicationPlan>(
    `/api/v1/supply/pools/${encodeURIComponent(poolId)}/publication-plans`,
    "supplier",
    { windowIds },
    idempotencyKey,
  );
}

export async function getSupplyOrder(orderId: string, role: "buyer" | "supplier" = "supplier") {
  const result = await exchangeGet<SupplyOrderDetail | { record: SupplyOrderDetail }>(
    `/api/v1/supply/orders/${encodeURIComponent(orderId)}`,
    role,
  );
  const detail = "record" in result ? result.record : result;
  if (!detail.order) throw new MarketplaceApiError({ code: "INVALID_RESPONSE", message: "订单接口未返回订单记录。", status: 200 });
  return detail;
}

export function createAlipayPaymentIntent(
  orderId: string,
  idempotencyKey = createIdempotencyKey("h100-alipay"),
) {
  return exchangePost<unknown>(
    `/api/v1/orders/${encodeURIComponent(orderId)}/payment-intents`,
    "buyer",
    {},
    idempotencyKey,
    30_000,
  ) as unknown as Promise<AlipayPaymentIntent>;
}

export function submitSshPublicKey(
  orderId: string,
  publicKey: string,
  idempotencyKey = createIdempotencyKey("h100-ssh-key"),
) {
  return exchangePost<unknown>(
    `/api/v1/supply/orders/${encodeURIComponent(orderId)}/ssh-key`,
    "buyer",
    { publicKey },
    idempotencyKey,
    30_000,
  ) as unknown as Promise<SshKeySubmission>;
}

export function supplyApiUnavailable(error: unknown) {
  return error instanceof MarketplaceApiError && [404, 501, 503].includes(error.status);
}
