import { createHash } from "node:crypto";
import type { ExchangeOrder, MarketListing, ProductVersion, TestSettlement } from "../exchange.ts";
import {
  parseClaimDeliveryPackage,
  parseCreateCapacityLot,
  parseCreateCheckout,
  parseCreateListingVersion,
  parseCreateResourceAsset,
  parseCreateVerificationRun,
  parseReviewDeliveryPackage,
  parseSubmitDeliveryPackage,
  parseSubmitOrderAcceptance,
  parseSupplierConfirmation,
  parseTestDeliveryConnection,
  parseTestMeterComplete,
  parseTestRecordSettlement,
  parseTestServiceStart,
} from "../exchange.ts";
import { createSqliteExchangeStore } from "./exchange-store-sqlite.ts";
import type { ExchangeMutationContext, ExchangeStore } from "./exchange-store.ts";

export const KAI_CNY_REFERENCE_RATE = 1.002;
export const GPU_LAB_BUYER = "local-gpu-lab-buyer";
export const GPU_LAB_SUPPLIER = "local-gpu-lab-supplier";
const GPU_LAB_OPS = "local-gpu-lab-ops";
const GPU_LAB_PAYMENT = "local-gpu-lab-payment-adapter";
const EVIDENCE_DIGEST = `sha256:${"a".repeat(64)}`;

class GpuLabError extends Error {
  readonly code: string;
  readonly status: 404 | 409 | 422;

  constructor(code: string, status: 404 | 409 | 422, message: string) {
    super(message);
    this.name = "GpuLabError";
    this.code = code;
    this.status = status;
  }
}

export type GpuLabPublishInput = {
  commandId: string;
  supplierName: string;
  productVersionId: string;
  gpuCount: number;
  region: string;
  sourceType: "PERSONAL" | "CLOUD" | "DATACENTER";
  priceKaiPerGpuHour: number;
};

export type GpuLabCheckoutInput = {
  commandId: string;
  listingVersionId: string;
  durationHours: number;
};

export type GpuLabProof = {
  resourceAssetId?: string;
  verificationRunId?: string;
  capacityLotId?: string;
  listingVersionId?: string;
  orderId?: string;
  deliveryPackageId?: string;
  connectionCheckId?: string;
  meteringSessionId?: string;
  acceptanceId?: string;
  settlementId?: string;
};

export type GpuLabSnapshot = {
  environment: "LOCAL_TEST";
  fundsMoved: false;
  kaiReferenceRate: number;
  virtualNow: string;
  products: ProductVersion[];
  listings: MarketListing[];
  orders: ExchangeOrder[];
};

function safeCommandId(value: string) {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 72);
  if (normalized.length < 8) throw new GpuLabError("GPU_LAB_INPUT_INVALID", 422, "操作编号格式无效。");
  return normalized;
}

function compactText(value: string, field: string, min: number, max: number) {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length < min || normalized.length > max) {
    throw new GpuLabError("GPU_LAB_INPUT_INVALID", 422, `${field} 长度不符合要求。`);
  }
  return normalized;
}

function payloadHash(payload: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function mutation(actorId: string, command: string, payload: unknown): ExchangeMutationContext {
  return { actorId, idempotencyKey: command, payloadHash: payloadHash(payload) };
}

function asWholeSecond(milliseconds: number) {
  return Math.floor(milliseconds / 1_000) * 1_000;
}

function utc(milliseconds: number) {
  return new Date(asWholeSecond(milliseconds)).toISOString();
}

function sourceLabel(sourceType: GpuLabPublishInput["sourceType"]) {
  if (sourceType === "PERSONAL") return "个人主机";
  if (sourceType === "CLOUD") return "云服务器";
  return "数据中心";
}

function assertGpuOrder(order: ExchangeOrder) {
  if (order.productCode !== "GPU_COMPUTE") {
    throw new GpuLabError("GPU_LAB_ORDER_INVALID", 409, "该订单不是 GPU 算力订单。");
  }
  return order;
}

export class GpuLabEngine {
  private readonly store: ExchangeStore;
  private virtualNowMs: number;

  constructor(databasePath: string = ":memory:", initialNowMs: number = Date.now()) {
    this.virtualNowMs = asWholeSecond(initialNowMs);
    this.store = createSqliteExchangeStore(databasePath, () => new Date(this.virtualNowMs));
  }

  private advanceTo(milliseconds: number) {
    this.virtualNowMs = Math.max(this.virtualNowMs, asWholeSecond(milliseconds));
  }

  async snapshot(): Promise<GpuLabSnapshot> {
    const [products, listings, orders] = await Promise.all([
      this.store.listProductVersions(),
      this.store.listMarketListings(),
      this.store.listOrders(GPU_LAB_BUYER, "buyer"),
    ]);
    return {
      environment: "LOCAL_TEST",
      fundsMoved: false,
      kaiReferenceRate: KAI_CNY_REFERENCE_RATE,
      virtualNow: utc(this.virtualNowMs),
      products: products.filter((product) => product.productCode === "GPU_COMPUTE"),
      listings: listings.filter((listing) => listing.productCode === "GPU_COMPUTE"),
      orders: orders.filter((order) => order.productCode === "GPU_COMPUTE"),
    };
  }

  async seedDemoInventory(): Promise<GpuLabSnapshot> {
    const products = await this.store.listProductVersions();
    const fixtures = [
      { id: "PV-GPU-RTX4090-PCIE-24GB", name: "上海个人主机 041", count: 1, region: "上海", price: 0.88, source: "PERSONAL" as const },
      { id: "PV-GPU-H100-SXM5-80GB", name: "华北数据中心 008", count: 8, region: "北京", price: 18.6, source: "DATACENTER" as const },
      { id: "PV-GPU-A100-SXM4-80GB", name: "华东云资源池 017", count: 4, region: "杭州", price: 7.4, source: "CLOUD" as const },
    ];
    for (const [index, fixture] of fixtures.entries()) {
      if (!products.some((product) => product.id === fixture.id)) continue;
      await this.publish({
        commandId: `gpu-lab-demo-${String(index + 1).padStart(3, "0")}`,
        supplierName: fixture.name,
        productVersionId: fixture.id,
        gpuCount: fixture.count,
        region: fixture.region,
        sourceType: fixture.source,
        priceKaiPerGpuHour: fixture.price,
      });
    }
    return this.snapshot();
  }

  async publish(input: GpuLabPublishInput): Promise<{ snapshot: GpuLabSnapshot; proof: GpuLabProof }> {
    const commandId = safeCommandId(input.commandId);
    const supplierName = compactText(input.supplierName, "供应方名称", 2, 36);
    const region = compactText(input.region, "区域", 2, 36);
    if (!Number.isSafeInteger(input.gpuCount) || input.gpuCount < 1 || input.gpuCount > 64) {
      throw new GpuLabError("GPU_LAB_INPUT_INVALID", 422, "GPU 数量应为 1–64 的整数。");
    }
    if (!Number.isFinite(input.priceKaiPerGpuHour) || input.priceKaiPerGpuHour < 0.01 || input.priceKaiPerGpuHour > 10_000) {
      throw new GpuLabError("GPU_LAB_INPUT_INVALID", 422, "卡时单价应在 0.01–10000 之间。");
    }
    const products = await this.store.listProductVersions();
    const product = products.find((item) => item.id === input.productVersionId && item.productCode === "GPU_COMPUTE");
    if (!product) throw new GpuLabError("GPU_LAB_INPUT_INVALID", 422, "GPU 型号不在可上架目录中。");

    this.advanceTo(Date.now());
    const startAtMs = this.virtualNowMs + 15 * 60_000;
    const endAtMs = startAtMs + 7 * 24 * 60 * 60_000;
    const source = sourceLabel(input.sourceType);
    const resourceInput = parseCreateResourceAsset({
      productVersionId: product.id,
      title: `${supplierName} · ${product.model} · ${input.gpuCount} 卡`,
      region,
      deliveryForm: input.sourceType === "PERSONAL" ? "容器实例 / SSH" : "云容器实例 / SSH",
      totalParallelUnits: input.gpuCount,
      interruptibility: "NON_INTERRUPTIBLE",
      networkScope: `${source}接入；包含本地测试连接、基础公网出口和标准交付检查。`,
    });
    const resource = (await this.store.createResource(
      mutation(GPU_LAB_SUPPLIER, `${commandId}:resource`, resourceInput),
      resourceInput,
    )).record;
    const verificationInput = parseCreateVerificationRun({
      method: input.sourceType === "CLOUD" ? "CLOUD_API" : "CONNECTOR",
      result: "PASS",
      evidenceSummary: `本地闭环已核对 ${product.displayName}、GPU 数量、区域、交付边界和连续可用时间窗。`,
      evidenceDigest: payloadHash({ commandId, product: product.id, count: input.gpuCount }),
      validUntil: utc(endAtMs + 24 * 60 * 60_000),
    });
    const verification = (await this.store.createVerification(
      resource.id,
      mutation(GPU_LAB_OPS, `${commandId}:verification`, verificationInput),
      verificationInput,
    )).record;
    const lotInput = parseCreateCapacityLot({
      resourceAssetId: resource.id,
      verificationRunId: verification.id,
      startAt: utc(startAtMs),
      endAt: utc(endAtMs),
      parallelUnits: input.gpuCount,
      interruptibility: "NON_INTERRUPTIBLE",
    });
    const lot = (await this.store.createCapacityLot(
      mutation(GPU_LAB_SUPPLIER, `${commandId}:lot`, lotInput),
      lotInput,
    )).record;
    const unitPriceCents = Math.max(1, Math.round(input.priceKaiPerGpuHour * KAI_CNY_REFERENCE_RATE * 100));
    const listingInput = parseCreateListingVersion({
      capacityLotId: lot.id,
      expectedLotVersion: lot.version,
      unitPriceCents,
      minParallelUnits: 1,
      maxParallelUnits: input.gpuCount,
      minDurationMinutes: 60,
      taxIncluded: true,
      energyIncluded: true,
      networkIncluded: true,
      scopeNote: `本地 TEST 上架；价格以 KAI 标准卡时展示，固定换算参考 1 KAI 卡时 = ¥${KAI_CNY_REFERENCE_RATE.toFixed(3)}。`,
      sla: { availabilityPercent: 99.5, responseMinutes: 30 },
      deliveryForm: resource.deliveryForm,
      validFrom: utc(Date.now() - 60_000),
      validUntil: utc(endAtMs - 24 * 60 * 60_000),
    });
    const listing = (await this.store.createListing(
      mutation(GPU_LAB_SUPPLIER, `${commandId}:listing`, listingInput),
      listingInput,
    )).record;
    return {
      snapshot: await this.snapshot(),
      proof: {
        resourceAssetId: resource.id,
        verificationRunId: verification.id,
        capacityLotId: lot.id,
        listingVersionId: listing.id,
      },
    };
  }

  async checkout(input: GpuLabCheckoutInput): Promise<{ snapshot: GpuLabSnapshot; order: ExchangeOrder; proof: GpuLabProof }> {
    const commandId = safeCommandId(input.commandId);
    if (!Number.isSafeInteger(input.durationHours) || input.durationHours < 1 || input.durationHours > 24) {
      throw new GpuLabError("GPU_LAB_INPUT_INVALID", 422, "租用时长应为 1–24 小时的整数。");
    }
    const listing = (await this.store.listMarketListings()).find((item) => item.id === input.listingVersionId);
    if (!listing || listing.productCode !== "GPU_COMPUTE") {
      throw new GpuLabError("GPU_LAB_LISTING_NOT_FOUND", 404, "没有找到可租用的 GPU 上架记录。");
    }
    this.advanceTo(Date.now());
    const startAtMs = Math.max(Date.parse(listing.lot.startAt), this.virtualNowMs + 10 * 60_000);
    const endAtMs = startAtMs + input.durationHours * 60 * 60_000;
    if (endAtMs > Date.parse(listing.lot.endAt)) {
      throw new GpuLabError("GPU_LAB_CAPACITY_UNAVAILABLE", 409, "该资源剩余可用时间不足。");
    }
    const checkoutInput = parseCreateCheckout({
      listingVersionId: listing.id,
      parallelUnits: 1,
      startAt: utc(startAtMs),
      endAt: utc(endAtMs),
      interruptibility: listing.lot.interruptibility,
    });
    let order = assertGpuOrder((await this.store.createCheckout(
      mutation(GPU_LAB_BUYER, `${commandId}:checkout`, checkoutInput),
      checkoutInput,
    )).record);
    const confirmation = parseSupplierConfirmation({
      action: "CONFIRM",
      expectedVersion: order.version,
      reason: "本地闭环供应端已确认库存、服务窗口和标准交付边界。",
    });
    order = assertGpuOrder((await this.store.confirmOrder(
      order.id,
      mutation(GPU_LAB_SUPPLIER, `${commandId}:confirm`, confirmation),
      confirmation,
    )).record);
    if (!order.payment) throw new GpuLabError("GPU_LAB_STATE_INVALID", 409, "测试支付单尚未生成。");
    const paymentAt = utc(this.virtualNowMs);
    const paymentEvent = {
      provider: "SIMULATED",
      environment: "TEST" as const,
      providerEventId: `LAB-EVT-${commandId}`,
      providerTransactionId: `LAB-TXN-${commandId}`,
      providerOrderId: order.payment.id,
      merchantAccountRef: order.payment.merchantAccountRef,
      eventType: "CAPTURED" as const,
      amountCents: order.payment.amountCents,
      currency: "CNY" as const,
      occurredAt: paymentAt,
      rawPayloadDigest: payloadHash({ orderId: order.id, amount: order.payment.amountCents }),
      verificationMethod: "SERVER_GENERATED_LOCAL_TEST_EVENT",
      verifiedAt: paymentAt,
      fundsMoved: false,
    };
    order = assertGpuOrder((await this.store.applyPaymentEvent(
      mutation(GPU_LAB_PAYMENT, `${commandId}:payment`, paymentEvent),
      paymentEvent,
    )).record);
    order = assertGpuOrder((await this.store.startProvisioning(
      order.id,
      mutation(GPU_LAB_SUPPLIER, `${commandId}:provision`, { orderId: order.id, version: order.version }),
      { expectedVersion: order.version, reason: "供应端开始创建隔离容器和一次性测试连接信息。" },
    )).record);
    if (!order.delivery) throw new GpuLabError("GPU_LAB_STATE_INVALID", 409, "交付任务尚未生成。");
    const packageInput = parseSubmitDeliveryPackage({
      expectedVersion: order.delivery.version,
      publicProfile: {
        protocol: "SSH",
        endpointDisplay: "gpu-***.local.kai.test",
        port: 22,
        usernameHint: "kai-lab-user",
        expiresAt: utc(endAtMs + 24 * 60 * 60_000),
        instructionsSummary: "领取一次性测试码后，由平台执行连接检查；页面不会展示真实密码或私钥。",
      },
      evidenceDigest: EVIDENCE_DIGEST,
    });
    const submitted = await this.store.submitDeliveryPackage(
      order.delivery.id,
      mutation(GPU_LAB_SUPPLIER, `${commandId}:delivery`, packageInput),
      packageInput,
    );
    const reviewInput = parseReviewDeliveryPackage({
      expectedVersion: submitted.record.version,
      decision: "PASS",
      verificationMethod: "SIMULATED_TEST",
      reason: "本地测试核验已确认脱敏端点、有效期和连接说明完整。",
      evidenceDigest: EVIDENCE_DIGEST,
    });
    await this.store.reviewDeliveryPackage(
      submitted.record.id,
      mutation(GPU_LAB_OPS, `${commandId}:review`, reviewInput),
      reviewInput,
    );
    order = assertGpuOrder(await this.store.getOrder(GPU_LAB_BUYER, order.id, "buyer"));
    if (!order.delivery?.package) throw new GpuLabError("GPU_LAB_STATE_INVALID", 409, "交付包核验状态缺失。");
    const claimInput = parseClaimDeliveryPackage({ expectedVersion: order.delivery.package.version });
    const claimed = await this.store.claimDeliveryPackage(
      order.delivery.package.id,
      mutation(GPU_LAB_BUYER, `${commandId}:claim`, claimInput),
      claimInput,
    );
    const connectionInput = parseTestDeliveryConnection({ expectedVersion: claimed.record.package.version });
    const connection = await this.store.testDeliveryConnection(
      claimed.record.package.id,
      mutation(GPU_LAB_BUYER, `${commandId}:connection`, connectionInput),
      connectionInput,
    );
    order = assertGpuOrder(await this.store.getOrder(GPU_LAB_BUYER, order.id, "buyer"));
    return {
      snapshot: await this.snapshot(),
      order,
      proof: {
        orderId: order.id,
        deliveryPackageId: claimed.record.package.id,
        connectionCheckId: connection.record.id,
        meteringSessionId: order.metering?.id,
      },
    };
  }

  async start(orderId: string): Promise<{ snapshot: GpuLabSnapshot; order: ExchangeOrder; proof: GpuLabProof }> {
    let order = assertGpuOrder(await this.store.getOrder(GPU_LAB_BUYER, orderId, "buyer"));
    if (!order.metering) throw new GpuLabError("GPU_LAB_STATE_INVALID", 409, "计量会话尚未生成。");
    this.advanceTo(Date.parse(order.startAt) + 60_000);
    const input = parseTestServiceStart({ expectedVersion: order.metering.version });
    if (!this.store.testStartService) throw new GpuLabError("GPU_LAB_UNAVAILABLE", 409, "测试计量尚未启用。");
    order = assertGpuOrder((await this.store.testStartService(
      order.id,
      mutation(GPU_LAB_OPS, `lab:${order.id}:start`, input),
      input,
    )).record);
    return { snapshot: await this.snapshot(), order, proof: { orderId, meteringSessionId: order.metering?.id } };
  }

  async complete(orderId: string): Promise<{ snapshot: GpuLabSnapshot; order: ExchangeOrder; proof: GpuLabProof }> {
    let order = assertGpuOrder(await this.store.getOrder(GPU_LAB_BUYER, orderId, "buyer"));
    if (!order.metering) throw new GpuLabError("GPU_LAB_STATE_INVALID", 409, "计量会话尚未生成。");
    this.advanceTo(Date.parse(order.endAt) + 1_000);
    const input = parseTestMeterComplete({ expectedVersion: order.metering.version });
    if (!this.store.testCompleteMetering) throw new GpuLabError("GPU_LAB_UNAVAILABLE", 409, "测试计量尚未启用。");
    order = assertGpuOrder((await this.store.testCompleteMetering(
      order.id,
      mutation(GPU_LAB_OPS, `lab:${order.id}:complete`, input),
      input,
    )).record);
    return {
      snapshot: await this.snapshot(),
      order,
      proof: { orderId, meteringSessionId: order.metering?.id, acceptanceId: order.acceptance?.id },
    };
  }

  async accept(orderId: string): Promise<{ snapshot: GpuLabSnapshot; order: ExchangeOrder; proof: GpuLabProof }> {
    let order = assertGpuOrder(await this.store.getOrder(GPU_LAB_BUYER, orderId, "buyer"));
    if (!order.acceptance) throw new GpuLabError("GPU_LAB_STATE_INVALID", 409, "订单尚未进入验收阶段。");
    const input = parseSubmitOrderAcceptance({
      expectedVersion: order.acceptance.version,
      decision: "ACCEPT",
      reason: "本地闭环已核对连接记录、服务时间窗、计量证据和交付结果。",
      evidenceDigest: EVIDENCE_DIGEST,
    });
    if (!this.store.submitAcceptance) throw new GpuLabError("GPU_LAB_UNAVAILABLE", 409, "测试验收尚未启用。");
    order = assertGpuOrder((await this.store.submitAcceptance(
      order.id,
      mutation(GPU_LAB_BUYER, `lab:${order.id}:accept`, input),
      input,
    )).record);
    return {
      snapshot: await this.snapshot(),
      order,
      proof: { orderId, acceptanceId: order.acceptance?.id, settlementId: order.settlement?.id },
    };
  }

  async settle(orderId: string): Promise<{ snapshot: GpuLabSnapshot; order: ExchangeOrder; settlement: TestSettlement; proof: GpuLabProof }> {
    let order = assertGpuOrder(await this.store.getOrder(GPU_LAB_BUYER, orderId, "buyer"));
    if (!order.settlement) throw new GpuLabError("GPU_LAB_STATE_INVALID", 409, "测试结算记录尚未生成。");
    const input = parseTestRecordSettlement({ expectedVersion: order.settlement.version });
    if (!this.store.testRecordSettlement) throw new GpuLabError("GPU_LAB_UNAVAILABLE", 409, "测试结算尚未启用。");
    const settlement = (await this.store.testRecordSettlement(
      order.settlement.id,
      mutation(GPU_LAB_OPS, `lab:${order.id}:settle`, input),
      input,
    )).record;
    order = assertGpuOrder(await this.store.getOrder(GPU_LAB_BUYER, order.id, "buyer"));
    return {
      snapshot: await this.snapshot(),
      order,
      settlement,
      proof: { orderId, settlementId: settlement.id },
    };
  }
}
