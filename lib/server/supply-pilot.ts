export const H100_PILOT_POLICY = Object.freeze({
  productVersionId: "PV-GPU-H100-SXM5-80GB",
  gpuCount: 8,
  formFactor: "SXM5",
  memoryGiB: 80,
  wholeNode: true,
  exclusive: true,
  migMode: "DISABLED",
  deliveryProtocol: "SSH",
  centsPerCardHour: 100,
  minNodeHours: 1,
  maxNodeHours: 8,
  campaignDays: 30,
  maxDistinctPrincipals: 10,
  maxOrdersPerPrincipal: 1,
  maxTotalNodeHours: 80,
  marketIndexEligible: false,
  automaticRenewal: false,
} as const);

export class SupplyPilotError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.code = code;
    this.name = "SupplyPilotError";
  }
}

export type H100PilotNode = {
  nodeId: string;
  productVersionId: string;
  model: string;
  formFactor: string;
  memoryGiB: number;
  gpuUuids: string[];
  migMode: string;
  topology: string;
  exclusive: boolean;
  deliveryProtocol: string;
  verification: {
    result: string;
    evidenceDigest: string;
    validUntil: string;
  };
  [key: string]: unknown;
};

export function validateH100PilotNode<T extends H100PilotNode>(node: T, options?: { orderStartAt?: string }): T {
  if (node.gpuUuids.length !== H100_PILOT_POLICY.gpuCount) {
    throw new SupplyPilotError("H100_NODE_REQUIRES_8_GPUS");
  }
  if (new Set(node.gpuUuids).size !== H100_PILOT_POLICY.gpuCount) {
    throw new SupplyPilotError("H100_GPU_UUIDS_NOT_UNIQUE");
  }
  if (node.migMode !== H100_PILOT_POLICY.migMode) {
    throw new SupplyPilotError("H100_MIG_NOT_ALLOWED");
  }
  if (
    node.productVersionId !== H100_PILOT_POLICY.productVersionId
    || node.model.toUpperCase() !== "H100"
    || node.formFactor !== H100_PILOT_POLICY.formFactor
    || node.memoryGiB !== H100_PILOT_POLICY.memoryGiB
    || node.topology !== "SINGLE_NODE_NVLINK"
    || !node.exclusive
    || node.deliveryProtocol !== H100_PILOT_POLICY.deliveryProtocol
  ) {
    throw new SupplyPilotError("H100_SPEC_MISMATCH");
  }
  if (
    node.verification.result !== "PASS"
    || !/^sha256:[a-f0-9]{64}$/iu.test(node.verification.evidenceDigest)
    || Number.isNaN(new Date(node.verification.validUntil).getTime())
  ) {
    throw new SupplyPilotError("H100_VERIFICATION_REQUIRED");
  }
  if (options?.orderStartAt) {
    const orderStart = new Date(options.orderStartAt).getTime();
    if (Number.isNaN(orderStart) || new Date(node.verification.validUntil).getTime() < orderStart) {
      throw new SupplyPilotError("H100_VERIFICATION_EXPIRED");
    }
  }
  return node;
}

export function deriveH100PilotQuote(input: { nodeHours: number; clientAmountCents?: number }) {
  if (!Number.isInteger(input.nodeHours)
    || input.nodeHours < H100_PILOT_POLICY.minNodeHours
    || input.nodeHours > H100_PILOT_POLICY.maxNodeHours) {
    throw new SupplyPilotError("H100_NODE_HOURS_OUT_OF_RANGE");
  }
  const cardHours = input.nodeHours * H100_PILOT_POLICY.gpuCount;
  return {
    nodeHours: input.nodeHours,
    cardHours,
    amountCents: cardHours * H100_PILOT_POLICY.centsPerCardHour,
    currency: "CNY" as const,
  };
}

export type H100PilotOrder = {
  orderId: string;
  principalId: string;
  nodeId: string;
  startAt: string;
  endAt: string;
  status: string;
  [key: string]: unknown;
};

function nodeHoursBetween(startAt: string, endAt: string) {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  const hours = (end - start) / 3_600_000;
  if (!Number.isFinite(hours) || !Number.isInteger(hours)) {
    throw new SupplyPilotError("H100_NODE_HOURS_OUT_OF_RANGE");
  }
  return hours;
}

function countsTowardPilot(order: H100PilotOrder) {
  return !["CANCELED", "CLOSED", "FAILED", "REFUNDED"].includes(order.status);
}

function overlaps(left: H100PilotOrder, right: H100PilotOrder) {
  return new Date(left.startAt).getTime() < new Date(right.endAt).getTime()
    && new Date(right.startAt).getTime() < new Date(left.endAt).getTime();
}

export function admitH100PilotOrder(input: {
  campaignStartedAt: string;
  now: string;
  node: H100PilotNode;
  orders: H100PilotOrder[];
  candidate: H100PilotOrder;
}) {
  const campaignStart = new Date(input.campaignStartedAt).getTime();
  const campaignEnd = campaignStart + H100_PILOT_POLICY.campaignDays * 86_400_000;
  const now = new Date(input.now).getTime();
  const candidateStart = new Date(input.candidate.startAt).getTime();
  const candidateEnd = new Date(input.candidate.endAt).getTime();
  if ([campaignStart, now, candidateStart, candidateEnd].some(Number.isNaN)
    || now < campaignStart || now >= campaignEnd
    || candidateStart < campaignStart || candidateEnd > campaignEnd) {
    throw new SupplyPilotError("H100_CAMPAIGN_CLOSED");
  }

  validateH100PilotNode(input.node, { orderStartAt: input.candidate.startAt });
  const quote = deriveH100PilotQuote({ nodeHours: nodeHoursBetween(input.candidate.startAt, input.candidate.endAt) });
  const activeOrders = input.orders.filter(countsTowardPilot);
  if (activeOrders.some((order) => order.principalId === input.candidate.principalId)) {
    throw new SupplyPilotError("H100_ONE_ORDER_PER_PRINCIPAL");
  }
  const principals = new Set(activeOrders.map((order) => order.principalId));
  if (!principals.has(input.candidate.principalId)
    && principals.size >= H100_PILOT_POLICY.maxDistinctPrincipals) {
    throw new SupplyPilotError("H100_PRINCIPAL_LIMIT_REACHED");
  }
  const consumedHours = activeOrders.reduce(
    (sum, order) => sum + nodeHoursBetween(order.startAt, order.endAt),
    0,
  );
  if (consumedHours + quote.nodeHours > H100_PILOT_POLICY.maxTotalNodeHours) {
    throw new SupplyPilotError("H100_NODE_HOUR_CAP_REACHED");
  }
  if (activeOrders.some((order) => order.nodeId === input.candidate.nodeId && overlaps(order, input.candidate))) {
    throw new SupplyPilotError("H100_NODE_WINDOW_OVERLAP");
  }
  return { ...input.candidate, ...quote };
}

export function projectPilotListingToMarket<T extends { promotional?: boolean }>(listing: T) {
  return listing.promotional ? null : listing;
}

export type MacMiniAssetInput = {
  serialHash: string;
  chip: string;
  cpuCores: number;
  gpuCores: number;
  memoryGiB: number;
  storageGiB: number;
  ethernetGbps: number;
  macosBuild: string;
  [key: string]: unknown;
};

export type MacMiniBatch = {
  batchId: string;
  idempotencyKey: string;
  payloadHash: string;
  replayed: boolean;
  assets: Array<MacMiniAssetInput & { lifecycle: "INVENTORY_ONLY"; publishable: false; groupKey: string }>;
  groups: Array<{ groupKey: string; count: number }>;
  marketProjection: null;
};

function macGroupKey(asset: MacMiniAssetInput) {
  return [
    asset.chip,
    asset.cpuCores,
    asset.gpuCores,
    asset.memoryGiB,
    asset.storageGiB,
    asset.ethernetGbps,
    asset.macosBuild,
  ].join("|");
}

async function digestId(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function ingestMacMiniBatch(
  request: { idempotencyKey: string; payloadHash: string; assets: MacMiniAssetInput[] },
  previous?: MacMiniBatch,
): Promise<MacMiniBatch> {
  if (previous?.idempotencyKey === request.idempotencyKey) {
    if (previous.payloadHash !== request.payloadHash) throw new SupplyPilotError("IDEMPOTENCY_CONFLICT");
    return { ...previous, replayed: true };
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(request.idempotencyKey)
    || !/^sha256:[a-f0-9]{64}$/iu.test(request.payloadHash)) {
    throw new SupplyPilotError("MAC_BATCH_INVALID");
  }
  const serials = request.assets.map((asset) => asset.serialHash);
  if (new Set(serials).size !== serials.length) throw new SupplyPilotError("MAC_SERIAL_DUPLICATE");
  const assets = request.assets.map((asset) => ({
    ...asset,
    lifecycle: "INVENTORY_ONLY" as const,
    publishable: false as const,
    groupKey: macGroupKey(asset),
  }));
  const groupCounts = new Map<string, number>();
  for (const asset of assets) groupCounts.set(asset.groupKey, (groupCounts.get(asset.groupKey) ?? 0) + 1);
  return {
    batchId: `MACB-${(await digestId(`${request.idempotencyKey}:${request.payloadHash}`)).slice(0, 24)}`,
    idempotencyKey: request.idempotencyKey,
    payloadHash: request.payloadHash,
    replayed: false,
    assets,
    groups: Array.from(groupCounts, ([groupKey, count]) => ({ groupKey, count })),
    marketProjection: null,
  };
}

type AlipayCallbackInput = {
  config: { appId: string; merchantId: string } | null;
  expectedOrder: { orderId: string; merchantOrderId: string; amountCents: number; currency: string };
  notification: {
    notificationId: string;
    outTradeNo: string;
    tradeNo: string;
    tradeStatus: string;
    totalAmount: string;
    appId: string;
    sellerId: string;
  } | null;
  priorPayment: {
    paymentId: string;
    notificationId: string;
    tradeNo: string;
    status: string;
    amountCents: number;
  } | null;
  browserReturnParams?: unknown;
};

export function applyAlipayCallback(
  input: AlipayCallbackInput,
  dependencies: { verifySignature(notification: NonNullable<AlipayCallbackInput["notification"]>): boolean },
) {
  if (!input.config) throw new SupplyPilotError("ALIPAY_NOT_CONFIGURED");
  if (!input.notification) throw new SupplyPilotError("ALIPAY_SERVER_NOTIFICATION_REQUIRED");
  if (!dependencies.verifySignature(input.notification)) throw new SupplyPilotError("ALIPAY_SIGNATURE_INVALID");
  if (input.notification.appId !== input.config.appId || input.notification.sellerId !== input.config.merchantId) {
    throw new SupplyPilotError("ALIPAY_MERCHANT_MISMATCH");
  }
  if (input.notification.outTradeNo !== input.expectedOrder.merchantOrderId) {
    throw new SupplyPilotError("PAYMENT_ORDER_MISMATCH");
  }
  const amount = /^\d+(?:\.\d{1,2})?$/u.test(input.notification.totalAmount)
    ? Math.round(Number(input.notification.totalAmount) * 100)
    : Number.NaN;
  if (amount !== input.expectedOrder.amountCents || input.expectedOrder.currency !== "CNY") {
    throw new SupplyPilotError("PAYMENT_AMOUNT_MISMATCH");
  }
  if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(input.notification.tradeStatus)) {
    throw new SupplyPilotError("PAYMENT_STATUS_NOT_CAPTURED");
  }
  if (input.priorPayment) {
    if (input.priorPayment.notificationId === input.notification.notificationId
      && input.priorPayment.tradeNo === input.notification.tradeNo
      && input.priorPayment.amountCents === amount) {
      return {
        payment: input.priorPayment,
        replayed: true,
        capacityReservationsCreated: 0,
        deliveryTasksCreated: 0,
      };
    }
    throw new SupplyPilotError("PAYMENT_TRANSACTION_CONFLICT");
  }
  return {
    payment: {
      paymentId: `ALIPAY-${input.notification.tradeNo}`,
      notificationId: input.notification.notificationId,
      tradeNo: input.notification.tradeNo,
      status: "CAPTURED" as const,
      amountCents: amount,
    },
    replayed: false,
    capacityReservationsCreated: 1,
    deliveryTasksCreated: 1,
  };
}

export type SshPilotDeliveryState = {
  taskState: "PENDING" | "PROVISIONING" | "VERIFYING" | "DELIVERED" | "IN_SERVICE" | "COMPLETED";
  credentialState: "NONE" | "READY" | "CLAIMED" | "REVOKED";
  connectionState: "UNTESTED" | "PASSED" | "FAILED";
  serviceState: "NOT_STARTED" | "ACTIVE" | "COMPLETED";
  cleanupState: "NOT_REQUIRED" | "REQUIRED" | "COMPLETED";
  relistAllowed: boolean;
  credentialExpiresAt?: string;
  latestConnectionAt?: string;
};

export function initialSshDeliveryState(): SshPilotDeliveryState {
  return {
    taskState: "PENDING",
    credentialState: "NONE",
    connectionState: "UNTESTED",
    serviceState: "NOT_STARTED",
    cleanupState: "NOT_REQUIRED",
    relistAllowed: false,
  };
}

type SshPilotAction =
  | { type: "SUPPLIER_START" }
  | { type: "PACKAGE_SUBMITTED" }
  | { type: "OPS_APPROVED"; credentialExpiresAt: string }
  | { type: "BUYER_CLAIMED"; at: string }
  | { type: "CONNECTION_PASSED"; at: string }
  | { type: "CONNECTION_FAILED"; at: string }
  | { type: "SERVICE_STARTED"; at: string; orderStartAt: string; orderEndAt: string }
  | { type: "SERVICE_COMPLETED"; at: string }
  | { type: "CREDENTIAL_REVOKED" }
  | { type: "DATA_CLEANED" };

function requireDelivery(condition: boolean, code: string): asserts condition {
  if (!condition) throw new SupplyPilotError(code);
}

export function transitionSshDelivery(state: SshPilotDeliveryState, action: SshPilotAction): SshPilotDeliveryState {
  switch (action.type) {
    case "SUPPLIER_START":
      requireDelivery(state.taskState === "PENDING", "SSH_TRANSITION_INVALID");
      return { ...state, taskState: "PROVISIONING" };
    case "PACKAGE_SUBMITTED":
      requireDelivery(state.taskState === "PROVISIONING", "SSH_TRANSITION_INVALID");
      return { ...state, taskState: "VERIFYING" };
    case "OPS_APPROVED":
      requireDelivery(state.taskState === "VERIFYING" && !Number.isNaN(new Date(action.credentialExpiresAt).getTime()), "SSH_TRANSITION_INVALID");
      return { ...state, taskState: "DELIVERED", credentialState: "READY", credentialExpiresAt: action.credentialExpiresAt };
    case "BUYER_CLAIMED":
      requireDelivery(state.taskState === "DELIVERED" && state.credentialState === "READY", "SSH_TRANSITION_INVALID");
      return { ...state, credentialState: "CLAIMED" };
    case "CONNECTION_PASSED":
    case "CONNECTION_FAILED":
      requireDelivery(state.taskState === "DELIVERED" && state.credentialState === "CLAIMED", "SSH_TRANSITION_INVALID");
      return { ...state, connectionState: action.type === "CONNECTION_PASSED" ? "PASSED" : "FAILED", latestConnectionAt: action.at };
    case "SERVICE_STARTED": { const at = new Date(action.at).getTime();
      requireDelivery(state.taskState === "DELIVERED" && state.connectionState === "PASSED", "SSH_CONNECTION_NOT_PASSED");
      requireDelivery(state.credentialState === "CLAIMED" && !!state.credentialExpiresAt, "SSH_CREDENTIAL_NOT_READY");
      requireDelivery(at <= new Date(state.credentialExpiresAt).getTime(), "SSH_CREDENTIAL_EXPIRED");
      requireDelivery(at >= new Date(action.orderStartAt).getTime() && at <= new Date(action.orderEndAt).getTime(), "SSH_SERVICE_OUTSIDE_ORDER_WINDOW");
      return { ...state, taskState: "IN_SERVICE", serviceState: "ACTIVE", relistAllowed: false };
    }
    case "SERVICE_COMPLETED":
      requireDelivery(state.taskState === "IN_SERVICE" && state.serviceState === "ACTIVE", "SSH_TRANSITION_INVALID");
      return { ...state, taskState: "COMPLETED", serviceState: "COMPLETED", cleanupState: "REQUIRED", relistAllowed: false };
    case "CREDENTIAL_REVOKED":
      requireDelivery(state.credentialState === "CLAIMED" || state.credentialState === "READY", "SSH_TRANSITION_INVALID");
      return { ...state, credentialState: "REVOKED" };
    case "DATA_CLEANED":
      requireDelivery(state.credentialState === "REVOKED", "SSH_CREDENTIAL_REVOKE_REQUIRED");
      requireDelivery(state.cleanupState === "REQUIRED", "SSH_CLEANUP_NOT_REQUIRED");
      return { ...state, cleanupState: "COMPLETED", relistAllowed: state.taskState === "COMPLETED" };
  }
}
