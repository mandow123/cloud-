import { ExchangeDomainError } from "./exchange-errors.ts";

export const SUPPLY_ASSET_KINDS = ["H100_8X_NODE", "MAC_MINI", "GENERAL_SERVER"] as const;
export type SupplyAssetKind = (typeof SUPPLY_ASSET_KINDS)[number];

export const SUPPLY_OFFER_SUPPLIER_TYPES = ["INDIVIDUAL", "COMPANY", "IDC", "CLOUD_VENDOR"] as const;
export type SupplyOfferSupplierType = (typeof SUPPLY_OFFER_SUPPLIER_TYPES)[number];
export const SUPPLY_OFFER_RESOURCE_TYPES = [
  "GPU_CARD", "GPU_SERVER", "CPU_SERVER", "MAC_COMPUTE", "TOKEN_CAPACITY", "MODEL_INSTANCE", "NAS_STORAGE", "RACK_CAPACITY", "CLOUD_RESOURCE",
] as const;
export type SupplyOfferResourceType = (typeof SUPPLY_OFFER_RESOURCE_TYPES)[number];
export const SUPPLY_OFFER_QUANTITY_UNITS = ["CARD", "NODE", "SERVER", "M_TOKENS_PER_HOUR", "MODEL_INSTANCE", "TIB", "RACK", "KW", "QUOTA_UNIT"] as const;
export type SupplyOfferQuantityUnit = (typeof SUPPLY_OFFER_QUANTITY_UNITS)[number];
export const SUPPLY_OFFER_PRICING_UNITS = ["CARD_HOUR", "NODE_HOUR", "SERVER_HOUR", "TOKEN_CAPACITY_HOUR", "MODEL_INSTANCE_HOUR", "TIB_HOUR", "RACK_MONTH", "KW_MONTH", "QUOTA_HOUR"] as const;
export type SupplyOfferPricingUnit = (typeof SUPPLY_OFFER_PRICING_UNITS)[number];

const SUPPLY_OFFER_UNIT_PAIRS: Readonly<Record<SupplyOfferResourceType, readonly (readonly [SupplyOfferQuantityUnit, SupplyOfferPricingUnit])[]>> = {
  GPU_CARD: [["CARD", "CARD_HOUR"]],
  GPU_SERVER: [["NODE", "NODE_HOUR"]],
  CPU_SERVER: [["SERVER", "SERVER_HOUR"]],
  MAC_COMPUTE: [["NODE", "NODE_HOUR"]],
  TOKEN_CAPACITY: [["M_TOKENS_PER_HOUR", "TOKEN_CAPACITY_HOUR"]],
  MODEL_INSTANCE: [["MODEL_INSTANCE", "MODEL_INSTANCE_HOUR"]],
  NAS_STORAGE: [["TIB", "TIB_HOUR"]],
  RACK_CAPACITY: [["RACK", "RACK_MONTH"], ["KW", "KW_MONTH"]],
  CLOUD_RESOURCE: [["QUOTA_UNIT", "QUOTA_HOUR"]],
};

export type SupplyOffer = Readonly<{
  id: string;
  supplierActorId: string;
  supplierType: SupplyOfferSupplierType;
  resourceType: SupplyOfferResourceType;
  quantity: number;
  quantityUnit: SupplyOfferQuantityUnit;
  pricingUnit: SupplyOfferPricingUnit;
  productName: string;
  specification: string;
  region: string;
  deliveryForm: string;
  availabilityStartAt: string | null;
  availabilityEndAt: string | null;
  notes: string | null;
  status: "DRAFT" | "SUBMITTED" | "UNDER_VERIFICATION" | "VERIFIED" | "REJECTED" | "PUBLISHED";
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateSupplyOfferInput = Readonly<{
  supplierType: SupplyOfferSupplierType;
  resourceType: SupplyOfferResourceType;
  quantity: number;
  quantityUnit: SupplyOfferQuantityUnit;
  pricingUnit: SupplyOfferPricingUnit;
  productName: string;
  specification: string;
  region: string;
  deliveryForm: string;
  availabilityStartAt: string | null;
  availabilityEndAt: string | null;
  notes: string | null;
}>;

export type SupplyMutationContext = Readonly<{
  actorId: string;
  idempotencyKey: string;
  payloadHash: string;
}>;

export type SupplyAssetPool = Readonly<{
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
}>;

export type PromotionPolicy = Readonly<{
  poolId: string;
  publicationMode: "H100_LIMITED_TRIAL" | "INVENTORY_ONLY";
  unitPriceMicrosPerGpuHour: number | null;
  gpuCountPerNode: number | null;
  maxOrderHours: number;
  maxBuyerNodeHours: number;
  maxTotalNodeHours: number;
  sshExclusiveRequired: boolean;
}>;

export type SupplyAssetMember = Readonly<{
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
}>;

export type SupplyComponent = Readonly<{
  id: string;
  memberId: string;
  componentType: "GPU" | "CPU" | "MEMORY" | "STORAGE" | "NETWORK" | "HOST";
  identityDigest: string;
  model: string;
  memoryGiB: number | null;
  topologyGroup: string | null;
  specs: Readonly<Record<string, unknown>>;
  status: "DECLARED" | "VERIFIED" | "REJECTED";
}>;

export type AgentEnrollment = Readonly<{
  id: string;
  memberId: string;
  supplierActorId: string;
  publicKeyDigest: string;
  status: "PENDING" | "ACTIVE" | "REVOKED";
  enrolledAt: string;
  lastSeenAt: string | null;
}>;

export type VerificationJob = Readonly<{
  id: string;
  poolId: string;
  memberId: string;
  requestedBy: string;
  reviewedBy: string | null;
  status: "PENDING" | "PASSED" | "FAILED";
  validUntil: string | null;
  createdAt: string;
  completedAt: string | null;
}>;

export type VerificationEvidence = Readonly<{
  id: string;
  jobId: string;
  evidenceType: string;
  payloadDigest: string;
  summary: string;
  observedAt: string;
  createdAt: string;
}>;

export type AvailabilityWindow = Readonly<{
  id: string;
  poolId: string;
  memberId: string;
  supplierActorId: string;
  startAt: string;
  endAt: string;
  status: "AVAILABLE" | "PROMOTED" | "SUSPENDED";
  createdAt: string;
}>;

export type SupplyPromotion = Readonly<{
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
}>;

export type ExchangeBinding = Readonly<{
  id: string;
  promotionId: string;
  poolId: string;
  memberId: string;
  availabilityWindowId: string;
  bindingMode: "ISOLATED_SUPPLY";
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
}>;

export type AllocationBinding = Readonly<{
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
}>;

export type SupplyTrialOrder = Readonly<{
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
}>;

export type SupplyTrialPaymentStatus = "PENDING" | "CAPTURED" | "CLOSED" | "REFUND_PENDING" | "REFUNDED" | "FAILED";
export type SupplyTrialDeliveryStatus = "AWAITING_PAYMENT" | "AWAITING_KEY" | "PROVISIONING" | "READY" | "IN_SERVICE" | "CLEANING" | "COMPLETED" | "FAILED";

export type SupplyTrialPayment = Readonly<{
  orderId: string;
  status: SupplyTrialPaymentStatus;
  provider: string;
  providerOrderRef: string;
  providerTransactionRef: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type SupplyTrialPaymentEvent = Readonly<{
  id: string;
  orderId: string;
  provider: string;
  providerEventRef: string;
  providerTransactionRef: string | null;
  eventType: string;
  operation: "CAPTURE" | "REFUND" | "OTHER";
  amountCents: number;
  payloadDigest: string;
  outcome: "APPLIED" | "IGNORED" | "REJECTED";
  resultingStatus: SupplyTrialPaymentStatus;
  occurredAt: string;
  receivedAt: string;
}>;

export type SupplyTrialDelivery = Readonly<{
  orderId: string;
  status: SupplyTrialDeliveryStatus;
  buyerPublicKeyFingerprint: string | null;
  secureEndpointRef: string | null;
  hostKeyFingerprint: string | null;
  credentialExpiresAt: string | null;
  cleanupEvidenceDigest: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type SupplyConnectionCheck = Readonly<{
  id: string;
  orderId: string;
  status: "RUNNING" | "PASSED" | "FAILED";
  diagnosticCode: string;
  evidenceDigest: string | null;
  startedAt: string;
  finishedAt: string | null;
}>;

export type CreatePoolInput = Readonly<{
  externalRef: string;
  assetKind: SupplyAssetKind;
  name: string;
  region: string;
  deliveryForm: string;
  specDigest: string;
}>;

export type MemberInput = Readonly<{
  externalRef: string;
  serialDigest: string;
  hardwareUuidDigest: string | null;
  specDigest: string;
}>;

export type MacInventoryItem = Readonly<{
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
  specDigest: string;
}>;

export type ComponentInput = Omit<SupplyComponent, "id" | "memberId" | "status">;
export type AvailabilityInput = Readonly<{ memberId: string; startAt: string; endAt: string }>;

function inputObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("请求内容必须是对象。", 400);
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra) fail(`${extra} 不是支持字段。`, 400);
}

function text(value: unknown, field: string, min = 1, max = 200) {
  if (typeof value !== "string") fail(`${field} 格式不正确。`, 400);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < min || normalized.length > max || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    fail(`${field} 格式不正确。`, 400);
  }
  return normalized;
}

function integer(value: unknown, field: string, min: number, max: number) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) fail(`${field} 超出范围。`, 400);
  return Number(value);
}

function digest(value: unknown, field: string) {
  const normalized = text(value, field, 71, 71).toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/u.test(normalized)) fail(`${field} 必须是 SHA-256 摘要。`, 400);
  return normalized;
}

export function utc(value: unknown, field: string) {
  const normalized = text(value, field, 20, 30);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(normalized)) fail(`${field} 必须是 UTC 时间。`, 400);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) fail(`${field} 不是有效时间。`, 400);
  return new Date(timestamp).toISOString();
}

export function fail(message: string, status = 422, code = "SUPPLY_INPUT_INVALID"): never {
  throw new ExchangeDomainError(code as never, status as 403 | 404 | 409 | 410 | 422, message);
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function parseCreatePool(value: unknown): CreatePoolInput {
  const input = inputObject(value);
  onlyKeys(input, ["externalRef", "assetKind", "name", "region", "deliveryForm", "specDigest"]);
  const assetKind = text(input.assetKind, "assetKind") as SupplyAssetKind;
  if (!SUPPLY_ASSET_KINDS.includes(assetKind)) fail("assetKind 不在支持范围内。", 400);
  return {
    externalRef: text(input.externalRef, "externalRef", 3, 100),
    assetKind,
    name: text(input.name, "name", 4, 120),
    region: text(input.region, "region", 2, 60),
    deliveryForm: text(input.deliveryForm, "deliveryForm", 2, 80),
    specDigest: digest(input.specDigest, "specDigest"),
  };
}

export function parseMemberBatch(value: unknown) {
  const input = inputObject(value);
  onlyKeys(input, ["items"]);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 500) fail("items 必须包含 1–500 条资产。", 400);
  const items = input.items.map((item, index): MemberInput => {
    const row = inputObject(item);
    onlyKeys(row, ["externalRef", "serialDigest", "hardwareUuidDigest", "specDigest"]);
    return {
      externalRef: text(row.externalRef, `items.${index}.externalRef`, 3, 100),
      serialDigest: digest(row.serialDigest, `items.${index}.serialDigest`),
      hardwareUuidDigest: row.hardwareUuidDigest == null ? null : digest(row.hardwareUuidDigest, `items.${index}.hardwareUuidDigest`),
      specDigest: digest(row.specDigest, `items.${index}.specDigest`),
    };
  });
  if (new Set(items.map((item) => item.externalRef)).size !== items.length) fail("批次内 externalRef 不能重复。", 400);
  return items;
}

export async function parseMacInventoryBatch(value: unknown) {
  const input = inputObject(value);
  onlyKeys(input, ["items"]);
  if (Array.isArray(input.items) && input.items.length > 300) fail("第一阶段最多导入 300 台 Mac。", 400);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 500) fail("items 必须包含 1–500 台 Mac。", 400);
  const rows = input.items.map((item, index) => {
    const row = inputObject(item);
    onlyKeys(row, ["externalRef", "serialDigest", "hardwareUuidDigest", "model", "chip", "memoryGiB", "storageGiB", "region", "networkProfile", "deliveryForm"]);
    return {
      externalRef: text(row.externalRef, `items.${index}.externalRef`, 3, 100),
      serialDigest: digest(row.serialDigest, `items.${index}.serialDigest`),
      hardwareUuidDigest: row.hardwareUuidDigest == null ? null : digest(row.hardwareUuidDigest, `items.${index}.hardwareUuidDigest`),
      model: text(row.model, `items.${index}.model`, 2, 80),
      chip: text(row.chip, `items.${index}.chip`, 2, 80),
      memoryGiB: integer(row.memoryGiB, `items.${index}.memoryGiB`, 8, 1024),
      storageGiB: integer(row.storageGiB, `items.${index}.storageGiB`, 64, 65_536),
      region: text(row.region, `items.${index}.region`, 2, 60),
      networkProfile: text(row.networkProfile, `items.${index}.networkProfile`, 2, 120),
      deliveryForm: text(row.deliveryForm, `items.${index}.deliveryForm`, 2, 80),
    };
  });
  if (new Set(rows.map((item) => item.externalRef)).size !== rows.length) fail("批次内 externalRef 不能重复。", 400);
  return Promise.all(rows.map(async (row): Promise<MacInventoryItem> => ({
    ...row,
    specDigest: await sha256(JSON.stringify([row.model, row.chip, row.memoryGiB, row.storageGiB, row.region, row.networkProfile, row.deliveryForm])),
  })));
}

export function parseComponentBatch(value: unknown) {
  const input = inputObject(value);
  onlyKeys(input, ["items"]);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 128) fail("items 必须包含 1–128 个组件。", 400);
  return input.items.map((item, index): ComponentInput => {
    const row = inputObject(item);
    onlyKeys(row, ["componentType", "identityDigest", "model", "memoryGiB", "topologyGroup", "specs"]);
    const componentType = text(row.componentType, `items.${index}.componentType`) as ComponentInput["componentType"];
    if (!["GPU", "CPU", "MEMORY", "STORAGE", "NETWORK", "HOST"].includes(componentType)) fail("componentType 不在支持范围内。", 400);
    const specs = row.specs == null ? {} : inputObject(row.specs);
    return {
      componentType,
      identityDigest: digest(row.identityDigest, `items.${index}.identityDigest`),
      model: text(row.model, `items.${index}.model`, 1, 120),
      memoryGiB: row.memoryGiB == null ? null : integer(row.memoryGiB, `items.${index}.memoryGiB`, 1, 1_000_000),
      topologyGroup: row.topologyGroup == null ? null : text(row.topologyGroup, `items.${index}.topologyGroup`, 2, 120),
      specs,
    };
  });
}

export function parseEnrollment(value: unknown) {
  const input = inputObject(value);
  onlyKeys(input, ["memberId", "publicKeyDigest"]);
  return { memberId: text(input.memberId, "memberId", 8, 100), publicKeyDigest: digest(input.publicKeyDigest, "publicKeyDigest") };
}

export function parseHeartbeat(value: unknown) {
  const input = inputObject(value);
  onlyKeys(input, ["observedAt", "payloadDigest"]);
  return { observedAt: utc(input.observedAt, "observedAt"), payloadDigest: digest(input.payloadDigest, "payloadDigest") };
}

export function parseCreateVerificationJob(value: unknown) {
  const input = inputObject(value);
  onlyKeys(input, ["memberId"]);
  return { memberId: text(input.memberId, "memberId", 8, 100) };
}

export function parseEvidence(value: unknown) {
  const input = inputObject(value);
  onlyKeys(input, ["evidenceType", "payloadDigest", "summary", "observedAt"]);
  return {
    evidenceType: text(input.evidenceType, "evidenceType", 3, 80),
    payloadDigest: digest(input.payloadDigest, "payloadDigest"),
    summary: text(input.summary, "summary", 8, 500),
    observedAt: utc(input.observedAt, "observedAt"),
  };
}

export function parseCompleteVerification(value: unknown) {
  const input = inputObject(value);
  onlyKeys(input, ["decision", "validUntil"]);
  const decision = text(input.decision, "decision") as "PASS" | "FAIL";
  if (!(["PASS", "FAIL"] as const).includes(decision)) fail("decision 不在支持范围内。", 400);
  const validUntil = decision === "PASS" ? utc(input.validUntil, "validUntil") : null;
  if (validUntil && Date.parse(validUntil) <= Date.now()) fail("validUntil 必须晚于当前时间。", 400);
  return { decision, validUntil };
}

export function parseAvailabilityBatch(value: unknown) {
  const input = inputObject(value);
  onlyKeys(input, ["items"]);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 500) fail("items 必须包含 1–500 个时间窗。", 400);
  return input.items.map((item, index): AvailabilityInput => {
    const row = inputObject(item);
    onlyKeys(row, ["memberId", "startAt", "endAt"]);
    const startAt = utc(row.startAt, `items.${index}.startAt`);
    const endAt = utc(row.endAt, `items.${index}.endAt`);
    if (Date.parse(endAt) <= Date.parse(startAt)) fail("时间窗结束时间必须晚于开始时间。", 400);
    return { memberId: text(row.memberId, `items.${index}.memberId`, 8, 100), startAt, endAt };
  });
}

export function parsePromotion(value: unknown) {
  const input = inputObject(value);
  onlyKeys(input, ["windowIds"]);
  if (!Array.isArray(input.windowIds) || input.windowIds.length < 1 || input.windowIds.length > 80) fail("windowIds 必须包含 1–80 个时间窗。", 400);
  const windowIds = input.windowIds.map((id, index) => text(id, `windowIds.${index}`, 8, 100));
  if (new Set(windowIds).size !== windowIds.length) fail("windowIds 不能重复。", 400);
  return { windowIds };
}

export function parsePublicationPlan(value: unknown) {
  const input = inputObject(value);
  onlyKeys(input, ["action", "windowIds"]);
  const action = text(input.action, "action") as "preview" | "commit";
  if (action !== "preview" && action !== "commit") fail("action 必须是 preview 或 commit。", 400);
  const parsed = parsePromotion({ windowIds: input.windowIds });
  return { action, windowIds: parsed.windowIds };
}

export function parseTrialOrder(value: unknown) {
  const input = inputObject(value);
  onlyKeys(input, ["promotionId", "startAt", "endAt"]);
  const startAt = utc(input.startAt, "startAt");
  const endAt = utc(input.endAt, "endAt");
  return { promotionId: text(input.promotionId, "promotionId", 8, 100), startAt, endAt };
}

export function parseTrialTransition(value: unknown) {
  const input = inputObject(value);
  onlyKeys(input, ["expectedVersion", "toStatus", "reason"]);
  const statuses = ["PAID", "PROVISIONING", "DELIVERED", "IN_SERVICE", "COMPLETED", "FAILED", "CANCELLED", "REFUND_PENDING", "REFUNDED"] as const;
  const toStatus = text(input.toStatus, "toStatus") as (typeof statuses)[number];
  if (!statuses.includes(toStatus)) fail("toStatus 不在支持范围内。", 400);
  return {
    expectedVersion: integer(input.expectedVersion, "expectedVersion", 1, 1_000_000_000),
    toStatus,
    reason: text(input.reason, "reason", 3, 300),
  };
}

export function parseCreateSupplyOffer(value: unknown): CreateSupplyOfferInput {
  const input = inputObject(value);
  onlyKeys(input, ["supplierType", "resourceType", "quantity", "quantityUnit", "pricingUnit", "productName", "specification", "region", "deliveryForm", "availabilityStartAt", "availabilityEndAt", "notes"]);
  const supplierType = text(input.supplierType, "supplierType") as SupplyOfferSupplierType;
  const resourceType = text(input.resourceType, "resourceType") as SupplyOfferResourceType;
  if (!SUPPLY_OFFER_SUPPLIER_TYPES.includes(supplierType)) fail("supplierType 不在支持范围内。", 400);
  if (!SUPPLY_OFFER_RESOURCE_TYPES.includes(resourceType)) fail("resourceType 不在支持范围内。", 400);
  const quantityUnit = text(input.quantityUnit, "quantityUnit", 1, 40) as SupplyOfferQuantityUnit;
  const pricingUnit = text(input.pricingUnit, "pricingUnit", 1, 60) as SupplyOfferPricingUnit;
  if (!SUPPLY_OFFER_QUANTITY_UNITS.includes(quantityUnit) || !SUPPLY_OFFER_PRICING_UNITS.includes(pricingUnit)
    || !SUPPLY_OFFER_UNIT_PAIRS[resourceType].some(([allowedQuantity, allowedPricing]) => allowedQuantity === quantityUnit && allowedPricing === pricingUnit)) {
    fail("资源类型、数量单位与计价单位不兼容。", 422);
  }
  if ((input.availabilityStartAt == null) !== (input.availabilityEndAt == null)) fail("availabilityStartAt 与 availabilityEndAt 必须同时提供。", 400);
  const availabilityStartAt = input.availabilityStartAt == null ? null : utc(input.availabilityStartAt, "availabilityStartAt");
  const availabilityEndAt = input.availabilityEndAt == null ? null : utc(input.availabilityEndAt, "availabilityEndAt");
  if (availabilityStartAt && availabilityEndAt && availabilityEndAt <= availabilityStartAt) fail("availabilityEndAt 必须晚于 availabilityStartAt。", 400);
  return {
    supplierType,
    resourceType,
    quantity: integer(input.quantity, "quantity", 1, 100_000),
    quantityUnit,
    pricingUnit,
    productName: text(input.productName, "productName", 2, 120),
    specification: text(input.specification, "specification", 2, 2_000),
    region: text(input.region, "region", 2, 80),
    deliveryForm: text(input.deliveryForm, "deliveryForm", 2, 120),
    availabilityStartAt,
    availabilityEndAt,
    notes: input.notes == null ? null : text(input.notes, "notes", 1, 2_000),
  } satisfies CreateSupplyOfferInput;
}
