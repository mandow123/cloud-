import type { PricingUnit, ResourceCategory } from "@/lib/types";
import type { MarketplaceRegion } from "@/lib/marketplace";

export const CURATED_DEMAND_OWNER = "system:kai-market";
const CURATED_DEMAND_REVISION = "kai-curated-demand-v3";
export const CURATED_DEMAND_REFRESH_LABEL = "每周一 06:10（北京时间）由系统滚动生成平台征集清单";
export const CURATED_DEMAND_IDS = Object.freeze([
  "KAI-R-20260806-A1344A1344A1344A",
  "KAI-R-20260806-B1152B1152B1152B",
  "KAI-R-20260806-C5760C5760C5760C",
  "KAI-R-20260806-D1200D1200D1200D",
  "KAI-R-20260806-E0090E0090E0090E",
]);

const CURATED_DEMAND_ID_SET = new Set(CURATED_DEMAND_IDS);

export function isCuratedMarketDemandId(id: string) {
  return CURATED_DEMAND_ID_SET.has(id);
}

export type CuratedMarketDemandRow = Readonly<{
  id: string;
  ownerActorId: typeof CURATED_DEMAND_OWNER;
  idempotencyKey: string;
  payloadHash: string;
  requestType: "procurement";
  kind: "rental" | "service";
  title: string;
  category: ResourceCategory;
  region: MarketplaceRegion;
  pricingUnit: PricingUnit;
  quantity: number;
  durationHours: number | null;
  deliveryDate: string;
  summary: string;
  status: "已记录";
  createdAt: string;
  updatedAt: string;
}>;

const DAY_MS = 86_400_000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1_000;

function latestReviewAt(now: Date) {
  const beijingNow = new Date(now.getTime() + BEIJING_OFFSET_MS);
  const daySinceMonday = (beijingNow.getUTCDay() + 6) % 7;
  const reviewLocalMs = Date.UTC(
    beijingNow.getUTCFullYear(),
    beijingNow.getUTCMonth(),
    beijingNow.getUTCDate() - daySinceMonday,
    6,
    10,
  );
  let reviewUtcMs = reviewLocalMs - BEIJING_OFFSET_MS;
  if (reviewUtcMs > now.getTime()) reviewUtcMs -= 7 * DAY_MS;
  return new Date(reviewUtcMs);
}

function deliveryDate(reviewAt: Date, daysAfterReview: number) {
  return new Date(reviewAt.getTime() + daysAfterReview * DAY_MS + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function revisionDigest(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function curatedMarketDemands(now = new Date()): readonly CuratedMarketDemandRow[] {
  const reviewAt = latestReviewAt(now);
  const reviewedAt = reviewAt.toISOString();
  const definitions = [
    {
      id: CURATED_DEMAND_IDS[0],
      kind: "rental" as const,
      title: "KAI 平台征集 · H100 80GB · 8 卡同节点连续 168 小时",
      category: "gpu" as const,
      region: "北京" as const,
      pricingUnit: "卡时" as const,
      quantity: 1_344,
      durationHours: 168,
      deliveryOffsetDays: 9,
      summary: "8 张 H100 80GB 同节点连续交付，NVLink 互联、裸金属优先；报价需列明税、电、网络、SLA 与开通时间。",
    },
    {
      id: CURATED_DEMAND_IDS[1],
      kind: "rental" as const,
      title: "KAI 平台征集 · H20 96GB · 16 卡连续 72 小时",
      category: "gpu" as const,
      region: "广东" as const,
      pricingUnit: "卡时" as const,
      quantity: 1_152,
      durationHours: 72,
      deliveryOffsetDays: 12,
      summary: "16 张 H20 96GB 批量推理资源，可由两个 8 卡节点交付；报价需列明容器环境、公网流量与故障响应。",
    },
    {
      id: CURATED_DEMAND_IDS[2],
      kind: "rental" as const,
      title: "KAI 平台征集 · A800 80GB · 8 卡同节点连续 30 天",
      category: "gpu" as const,
      region: "内蒙古" as const,
      pricingUnit: "卡时" as const,
      quantity: 5_760,
      durationHours: 720,
      deliveryOffsetDays: 16,
      summary: "8 张 A800 80GB 同节点训练资源，要求高速卡间互联、连续服务和训练数据盘；报价需列明存储、网络与运维边界。",
    },
    {
      id: CURATED_DEMAND_IDS[3],
      kind: "service" as const,
      title: "KAI 平台征集 · 文本模型 API · 月计划 120 亿 Token",
      category: "token_model" as const,
      region: "上海" as const,
      pricingUnit: "百万 Token" as const,
      quantity: 12_000,
      durationHours: null,
      deliveryOffsetDays: 7,
      summary: "文本模型调用服务按输入与输出 4:1 的固定用量比例报价，并列明上下文档位、并发限制、SLA 与用量报表。",
    },
    {
      id: CURATED_DEMAND_IDS[4],
      kind: "rental" as const,
      title: "KAI 平台征集 · 30kW 液冷机柜 · 连续 3 个月",
      category: "rack_capacity" as const,
      region: "浙江" as const,
      pricingUnit: "kW 月" as const,
      quantity: 90,
      durationHours: null,
      deliveryOffsetDays: 28,
      summary: "30kW 冷板液冷容量连续 3 个月，支持双路供电和基础网络；报价需列明 PUE、电费、机位、网络和进场条件。",
    },
  ] as const;

  return definitions.map((definition) => {
    const expectedDeliveryDate = deliveryDate(reviewAt, definition.deliveryOffsetDays);
    const material = JSON.stringify([
      definition.kind,
      definition.title,
      definition.category,
      definition.region,
      definition.pricingUnit,
      definition.quantity,
      definition.durationHours,
      expectedDeliveryDate,
      definition.summary,
    ]);
    return {
      id: definition.id,
      ownerActorId: CURATED_DEMAND_OWNER,
      idempotencyKey: `curated-${definition.id}`,
      payloadHash: `${CURATED_DEMAND_REVISION}:${definition.id}:${reviewedAt}:${revisionDigest(material)}`,
      requestType: "procurement",
      kind: definition.kind,
      title: definition.title,
      category: definition.category,
      region: definition.region,
      pricingUnit: definition.pricingUnit,
      quantity: definition.quantity,
      durationHours: definition.durationHours,
      deliveryDate: expectedDeliveryDate,
      summary: definition.summary,
      status: "已记录" as const,
      createdAt: reviewedAt,
      updatedAt: reviewedAt,
    };
  });
}
