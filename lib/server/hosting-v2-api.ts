import { AccountAuthError, assertAccountAuthSameOrigin } from "./account-auth.ts";
import { mutationHash, prepareWrite, requireIdempotencyKey } from "./api-guard.ts";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "./marketplace-auth.ts";
import type { HostingMutationContext } from "./hosting-v2-store.ts";
import { HOSTING_V2_AGENT_STALE_SECONDS, type HostingContract, type HostingContractEvidence, type HostingDevice, type HostingOffer } from "../hosting-v2.ts";
import type { SupplierDeviceTask, SupplierDeviceWorkspace, SupplierDeviceWorkspaceRow, SupplierDeviceWorkspaceState } from "../hosting-v2-client.ts";

export { requireHostingV2Enabled, requireHostingV2SetupEnabled } from "./hosting-v2-feature.ts";

export function hostingObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "提交内容必须是对象。 ");
  return value as Record<string, unknown>;
}

export function hostingString(input: Record<string, unknown>, field: string, minimum = 1, maximum = 500) {
  const value = typeof input[field] === "string" ? input[field].trim() : "";
  if (value.length < minimum || value.length > maximum) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, `${field} 长度应为 ${minimum}–${maximum} 个字符。 `);
  return value;
}

export function hostingInteger(input: Record<string, unknown>, field: string, minimum = 0) {
  const value = input[field];
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, `${field} 必须是大于等于 ${minimum} 的整数。 `);
  return Number(value);
}

export function hostingBoolean(input: Record<string, unknown>, field: string) {
  if (typeof input[field] !== "boolean") throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, `${field} 必须是布尔值。 `);
  return input[field];
}

export function hostingContractClientView(contract: HostingContract, evidence?: HostingContractEvidence) {
  return {
    id: contract.id,
    offerId: contract.offerId,
    snapshot: contract.snapshot,
    reservedSeconds: contract.reservedSeconds,
    measuredSeconds: contract.measuredSeconds,
    heldMicros: contract.heldMicros,
    settledMicros: contract.settledMicros,
    status: contract.status,
    sshPublicKeyFingerprint: contract.sshPublicKeyFingerprint,
    endpointDisplay: contract.endpointDisplay,
    startedAt: contract.startedAt,
    stoppedAt: contract.stoppedAt,
    acceptedAt: contract.acceptedAt,
    version: contract.version,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
    evidence,
  };
}

export function hostingSupplierContractClientView(contract: HostingContract, evidence?: HostingContractEvidence) {
  return {
    id: contract.id,
    offerId: contract.offerId,
    deviceId: contract.deviceId,
    snapshot: contract.snapshot,
    reservedSeconds: contract.reservedSeconds,
    measuredSeconds: contract.measuredSeconds,
    heldMicros: contract.heldMicros,
    settledMicros: contract.settledMicros,
    supplierIncomeMicros: contract.supplierIncomeMicros,
    commissionMicros: contract.commissionMicros,
    status: contract.status,
    sshPublicKeyFingerprint: contract.sshPublicKeyFingerprint,
    endpointDisplay: contract.endpointDisplay,
    startedAt: contract.startedAt,
    stoppedAt: contract.stoppedAt,
    acceptedAt: contract.acceptedAt,
    version: contract.version,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
    evidence,
  };
}

export function hostingSupplierOfferClientView(offer: import("../hosting-v2.ts").HostingOffer) {
  return {
    id: offer.id,
    deviceId: offer.deviceId,
    title: offer.title,
    gpuModel: offer.gpuModel,
    region: offer.region,
    cardHourMicrosPerGpuHour: offer.cardHourMicrosPerGpuHour,
    minRentalSeconds: offer.minRentalSeconds,
    maxRentalSeconds: offer.maxRentalSeconds,
    availableFrom: offer.availableFrom,
    availableUntil: offer.availableUntil,
    approvedImage: offer.approvedImage,
    termsVersion: offer.termsVersion,
    status: offer.status,
    version: offer.version,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
  };
}

const CONTRACT_IN_PROGRESS = new Set(["RESERVED", "CARD_HOURS_HELD", "PAID", "PROVISIONING", "READY", "CLEANING"]);
const CONTRACT_OPERATING = new Set(["IN_SERVICE", "AWAITING_ACCEPTANCE"]);
const CONTRACT_NEEDS_ACTION = new Set(["DISPUTED", "FAILED"]);
const CONTRACT_ACTIVE = new Set([...CONTRACT_IN_PROGRESS, ...CONTRACT_OPERATING, ...CONTRACT_NEEDS_ACTION]);

export function hostingSupplierDeviceWorkspaceView(
  devices: readonly HostingDevice[],
  offers: readonly HostingOffer[],
  contracts: readonly HostingContract[],
  supplierOrganizationId: string,
  now: string,
): SupplierDeviceWorkspace {
  const nowMs = Date.parse(now);
  const staleCutoff = nowMs - HOSTING_V2_AGENT_STALE_SECONDS * 1_000;
  const supplierContracts = contracts.filter((contract) => contract.supplierOrganizationId === supplierOrganizationId);
  const records: SupplierDeviceWorkspaceRow[] = [];
  const tasks: SupplierDeviceTask[] = [];

  for (const device of devices) {
    const deviceOffers = offers.filter((offer) => offer.deviceId === device.id);
    const publishedOfferCount = deviceOffers.filter((offer) => offer.status === "PUBLISHED").length;
    const activeContract = supplierContracts.find((contract) => contract.deviceId === device.id && CONTRACT_ACTIVE.has(contract.status)) ?? null;
    const lastSeenMs = device.lastSeenAt ? Date.parse(device.lastSeenAt) : Number.NaN;
    const stale = !Number.isFinite(lastSeenMs) || lastSeenMs < staleCutoff;
    const verificationValid = device.verificationStatus === "PASSED"
      && Boolean(device.verifiedUntil && Date.parse(device.verifiedUntil) > nowMs);
    let state: SupplierDeviceWorkspaceState = "AVAILABLE";
    let stateLabel = "待租";
    let stateDetail = publishedOfferCount > 0 ? "设备在线，挂牌可接受预留" : "设备在线，等待创建挂牌";
    let task: SupplierDeviceTask | null = null;

    if (device.status === "REVOKED") {
      state = "DISABLED"; stateLabel = "已停用"; stateDetail = "Agent 身份已撤销，不会接收平台任务";
    } else if (device.status === "DRAINING" && activeContract?.status === "CLEANING") {
      state = "DEPLOYING"; stateLabel = "清理中"; stateDetail = "Agent 正在撤销访问并清理受控实例，完成前不会重新挂牌";
    } else if (device.status === "DRAINING" || (activeContract && CONTRACT_NEEDS_ACTION.has(activeContract.status))) {
      state = "ACTION_REQUIRED"; stateLabel = "待处理";
      stateDetail = device.status === "DRAINING" ? "设备处于隔离清理状态，完成清理前不会重新挂牌" : "订单异常需要处理";
      task = {
        id: `${device.id}:delivery-risk`, deviceId: device.id, priority: "P0", title: `${device.displayName} 需要处理`,
        description: stateDetail, href: activeContract ? `/supply/orders/${encodeURIComponent(activeContract.id)}` : `/supply/devices/${encodeURIComponent(device.id)}`,
      };
    } else if (device.status === "OFFLINE" || stale) {
      state = "OFFLINE"; stateLabel = "离线"; stateDetail = "Host Agent 心跳已中断；这不代表设备已永久关闭";
      task = {
        id: `${device.id}:offline`, deviceId: device.id, priority: "P1", title: `${device.displayName} 已离线`,
        description: "检查主机电源、网络与 Host Agent 服务，恢复心跳后再验真。", href: `/supply/devices/${encodeURIComponent(device.id)}`,
      };
    } else if (activeContract && CONTRACT_OPERATING.has(activeContract.status)) {
      state = "OPERATING"; stateLabel = "运营中"; stateDetail = activeContract.status === "IN_SERVICE" ? "实例正在运行并由 Agent 计量" : "服务已停止，等待买家验收";
    } else if (activeContract && CONTRACT_IN_PROGRESS.has(activeContract.status)) {
      state = "DEPLOYING"; stateLabel = activeContract.status === "CLEANING" ? "清理中" : "部署中";
      stateDetail = activeContract.status === "READY" ? "实例已就绪，等待买家启动" : activeContract.status === "CLEANING" ? "Agent 正在撤销访问并清理受控实例" : "正在锁定卡时并创建受控实例";
    } else if (device.status === "VERIFYING" || device.verificationStatus === "PENDING") {
      state = "DEPLOYING"; stateLabel = "验真中"; stateDetail = "Host Agent 正在运行受控硬件与网络测试";
    } else if (!verificationValid) {
      state = "ACTION_REQUIRED"; stateLabel = "待处理";
      stateDetail = device.verificationStatus === "FAILED" ? "设备验真未通过" : device.verificationStatus === "EXPIRED" ? "验真证据已过期" : "设备尚未完成验真";
      task = {
        id: `${device.id}:verification`, deviceId: device.id, priority: "P1", title: `${device.displayName} 需要验真`,
        description: stateDetail, href: `/supply/devices/${encodeURIComponent(device.id)}`,
      };
    } else if (device.status === "BUSY") {
      state = "ACTION_REQUIRED"; stateLabel = "待处理"; stateDetail = "设备报告忙碌，但当前没有可见的活动合同";
      task = {
        id: `${device.id}:orphan-busy`, deviceId: device.id, priority: "P0", title: `${device.displayName} 状态不一致`,
        description: stateDetail, href: `/supply/devices/${encodeURIComponent(device.id)}`,
      };
    } else if (publishedOfferCount === 0) {
      task = {
        id: `${device.id}:listing`, deviceId: device.id, priority: "P2", title: `${device.displayName} 尚未挂牌`,
        description: "设备已在线且验真有效，可以创建可售时间窗和卡时价格。", href: "/supply/listings/new",
      };
    }

    if (task) tasks.push(task);
    records.push({
      id: device.id, displayName: device.displayName, gpuModel: device.inventory.gpuModel, gpuMemoryMiB: device.inventory.gpuMemoryMiB,
      state, stateLabel, stateDetail, verificationStatus: device.verificationStatus, lastSeenAt: device.lastSeenAt,
      activeContractId: activeContract?.id ?? null, activeContractStatus: activeContract?.status ?? null,
      publishedOfferCount, taskCount: task ? 1 : 0,
    });
  }

  const summary = Object.fromEntries(["AVAILABLE", "DEPLOYING", "OPERATING", "ACTION_REQUIRED", "OFFLINE", "DISABLED"].map((state) => [state, records.filter((record) => record.state === state).length])) as Record<SupplierDeviceWorkspaceState, number>;
  const priorityRank = { P0: 0, P1: 1, P2: 2 } as const;
  tasks.sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority] || left.title.localeCompare(right.title, "zh-CN"));
  return {
    generatedAt: now,
    summary,
    records,
    tasks,
    historyCapabilities: {
      renewal: { enabled: false, label: "已续约", reason: "托管合同续约实体和审核规则尚未开放，当前不生成虚假记录。" },
      buyback: { enabled: false, label: "已回购", reason: "回购涉及法务、出款与资金存管，生产入口保持关闭。" },
      decommission: { enabled: false, label: "设备关闭", reason: "永久退场需要受控撤权、挂牌下架和设备证据；当前只展示可验证的离线状态。" },
    },
  };
}

export async function hostingMutationContext(request: Request, actorId: string, body: unknown): Promise<HostingMutationContext> {
  assertAccountAuthSameOrigin(request);
  const authorization = await authorizeMarketplaceRequest(request);
  prepareWrite(request, authorization.actor);
  await persistMarketplaceSession(authorization);
  return {
    actorId,
    idempotencyKey: requireIdempotencyKey(request),
    payloadHash: await mutationHash(body),
    now: new Date().toISOString(),
  };
}
