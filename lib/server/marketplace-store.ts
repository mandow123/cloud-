import {
  createMarketplaceId,
  MarketplaceInputError,
  type CreateMarketplaceDraft,
  type CreateMarketplaceQuote,
  type CreateMarketplaceRequest,
  type MarketplaceDraftRecord,
  type MarketplaceNormalizedQuoteRecord,
  type MarketplaceRequestRecord,
  type MarketplaceSupplierQuoteRecord,
} from "@/lib/marketplace";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";

export const MARKETPLACE_SCHEMA_VERSION = 2;
export const MARKETPLACE_RETENTION_DAYS = 30;

export type MarketplaceStoreHealth = {
  backend: "sqlite" | "d1";
  schemaVersion: number;
  integrity: "ok";
  requests: number;
  quotes: number;
  drafts: number;
  events: number;
};

export type MarketplaceMutationContext = {
  actorId: string;
  idempotencyKey: string;
  payloadHash: string;
};

export type MarketplaceMutationResult<T> = {
  record: T;
  replayed: boolean;
};

export type MarketplaceListOptions = {
  limit: number;
  cursor: string | null;
};

export type MarketplacePage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type MarketplaceCursor = {
  createdAt: string;
  id: string;
};

export type MarketplaceQuoteWriteRecord = {
  supplier: MarketplaceSupplierQuoteRecord;
  normalized: MarketplaceNormalizedQuoteRecord;
};

export interface MarketplaceStore {
  establishSession(actor: MarketplaceActor): Promise<void>;
  touchSession(actor: MarketplaceActor): Promise<boolean>;
  consumeWriteAllowance(actorId: string, routeScope: "requests" | "quotes" | "drafts"): Promise<void>;
  listOwnedRequests(actorId: string, options: MarketplaceListOptions): Promise<MarketplacePage<MarketplaceRequestRecord>>;
  listPublicRequests(options: MarketplaceListOptions): Promise<MarketplacePage<MarketplaceRequestRecord>>;
  createRequest(context: MarketplaceMutationContext, input: CreateMarketplaceRequest): Promise<MarketplaceMutationResult<MarketplaceRequestRecord>>;
  listBuyerNormalizedQuotes(actorId: string, options: MarketplaceListOptions): Promise<MarketplacePage<MarketplaceNormalizedQuoteRecord>>;
  listSupplierQuotes(actorId: string, options: MarketplaceListOptions): Promise<MarketplacePage<MarketplaceSupplierQuoteRecord>>;
  createQuote(context: MarketplaceMutationContext, input: CreateMarketplaceQuote): Promise<MarketplaceMutationResult<MarketplaceSupplierQuoteRecord>>;
  listOwnedDrafts(actorId: string, options: MarketplaceListOptions): Promise<MarketplacePage<MarketplaceDraftRecord>>;
  createDraft(context: MarketplaceMutationContext, input: CreateMarketplaceDraft): Promise<MarketplaceMutationResult<MarketplaceDraftRecord>>;
  health(): Promise<MarketplaceStoreHealth>;
}

const categoryLabel = {
  gpu: "GPU 算力",
  token_model: "Token / 模型",
  rack_capacity: "整机柜 / 容量",
  cloud_vendor: "云厂商资源",
} as const;

function encodeBase64Url(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeMarketplaceCursor(cursor: MarketplaceCursor) {
  return encodeBase64Url(JSON.stringify([cursor.createdAt, cursor.id]));
}

function validCursorSecret(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value) return false;
  if (new TextEncoder().encode(value).byteLength < 32 || new Set(value).size < 8) return false;
  return !/(?:change[-_ ]?me|dummy|example|placeholder|replace|test[-_ ]?secret|your[-_ ])/iu.test(value);
}

async function cursorSecret() {
  let configured = typeof process !== "undefined" ? process.env.KAI_CURSOR_SECRET : undefined;
  if (!configured) {
    try {
      const cloudflare = await import("cloudflare:workers");
      const candidate = cloudflare.env.KAI_CURSOR_SECRET;
      configured = typeof candidate === "string" ? candidate : undefined;
    } catch {
      // Direct Node does not expose the Cloudflare environment module.
    }
  }
  if (configured !== undefined) {
    if (!validCursorSecret(configured)) throw new Error("KAI_CURSOR_SECRET_INVALID");
    return configured;
  }
  const production = typeof process === "undefined" || process.env.NODE_ENV === "production";
  if (production) throw new Error("KAI_CURSOR_SECRET_REQUIRED");
  return "kai-cloud-local-only-cursor-key-9c38f028a4dd4c2494ff6b84384df0ce";
}

export async function assertMarketplaceSecurityConfiguration() {
  await cursorSecret();
}

async function cursorSignature(payload: string, audience: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(await cursorSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${audience}\n${payload}`));
  return encodeBase64Url(new Uint8Array(signature).slice(0, 18));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function encodeSignedMarketplaceCursor(cursor: MarketplaceCursor, audience: string) {
  const payload = encodeMarketplaceCursor(cursor);
  return `${payload}.${await cursorSignature(payload, audience)}`;
}

export async function decodeMarketplaceCursor(value: string | null, audience: string): Promise<MarketplaceCursor | null> {
  if (!value) return null;
  try {
    const [payload, suppliedSignature, extra] = value.split(".");
    if (!payload || !suppliedSignature || extra) throw new Error("invalid cursor envelope");
    const expectedSignature = await cursorSignature(payload, audience);
    if (!constantTimeEqual(suppliedSignature, expectedSignature)) throw new Error("invalid cursor signature");
    const parsed = JSON.parse(decodeBase64Url(payload)) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error("invalid cursor");
    const [createdAt, id] = parsed;
    if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) throw new Error("invalid cursor date");
    if (typeof id !== "string" || !/^KAI-[RXQD]-\d{8}-[A-F0-9]{8,32}$/u.test(id)) throw new Error("invalid cursor id");
    return { createdAt, id };
  } catch {
    throw new MarketplaceInputError("分页游标已失效，请从第一页重新加载。", "cursor");
  }
}

export async function marketplacePage<T extends { id: string; createdAt: string }>(
  rows: T[],
  limit: number,
  audience: string,
): Promise<MarketplacePage<T>> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? await encodeSignedMarketplaceCursor({ createdAt: last.createdAt, id: last.id }, audience) : null,
  };
}

export function requestRecord(input: CreateMarketplaceRequest): MarketplaceRequestRecord {
  const now = new Date().toISOString();
  if (input.requestType === "procurement") {
    return {
      id: createMarketplaceId("R"),
      requestType: "procurement",
      kind: input.dealMode,
      title: `${input.dealMode === "rental" ? "租赁" : "服务采购"} · ${categoryLabel[input.category]} · ${input.quantity} ${input.pricingUnit}`,
      category: input.category,
      region: input.region,
      pricingUnit: input.pricingUnit,
      quantity: input.quantity,
      durationHours: input.durationHours,
      deliveryDate: input.deliveryDate,
      summary: input.requirements,
      offered: null,
      wanted: null,
      cashDirection: "none",
      cashAmount: null,
      status: "已记录",
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    id: createMarketplaceId("X"),
    requestType: "swap",
    kind: "swap",
    title: `${categoryLabel[input.offered.category]} → ${categoryLabel[input.wanted.category]} 双边置换`,
    category: input.wanted.category,
    region: input.region,
    pricingUnit: input.wanted.pricingUnit,
    quantity: input.wanted.quantity,
    durationHours: null,
    deliveryDate: null,
    summary: `可提供：${input.offered.description}；期望：${input.wanted.description}`,
    offered: input.offered,
    wanted: input.wanted,
    cashDirection: input.cashDirection,
    cashAmount: input.cashAmount,
    status: "已记录",
    createdAt: now,
    updatedAt: now,
  };
}

export function publicRequestRecord(record: MarketplaceRequestRecord): MarketplaceRequestRecord {
  const publicLeg = (leg: MarketplaceRequestRecord["offered"], label: string) => leg ? {
    ...leg,
    description: `${label}已登记；详细规格由 KAI 人工撮合时核验。`,
  } : null;
  return {
    ...record,
    summary: `匿名市场需求：${categoryLabel[record.category]}，${record.region}，${record.quantity} ${record.pricingUnit}。`,
    offered: publicLeg(record.offered, "可提供资源"),
    wanted: publicLeg(record.wanted, "所需资源"),
    cashAmount: record.cashDirection === "none" ? null : 0,
  };
}

export function quoteWriteRecord(
  input: CreateMarketplaceQuote,
  demand: MarketplaceRequestRecord,
): MarketplaceQuoteWriteRecord {
  const createdAt = new Date().toISOString();
  const validUntilDate = new Date(createdAt);
  validUntilDate.setUTCDate(validUntilDate.getUTCDate() + input.validDays);
  const id = createMarketplaceId("Q");
  const adjustedPrice = input.unitPrice * 1.03;
  const priceStep = adjustedPrice >= 10_000
    ? 500
    : adjustedPrice >= 1_000
      ? 100
      : adjustedPrice >= 100
        ? 10
        : adjustedPrice >= 10
          ? 1
          : adjustedPrice >= 1
            ? 0.1
            : 0.01;
  let standardizedUnitPrice = Math.ceil((adjustedPrice - Number.EPSILON) / priceStep) * priceStep;
  standardizedUnitPrice = Number(standardizedUnitPrice.toFixed(2));
  if (standardizedUnitPrice === input.unitPrice) {
    standardizedUnitPrice = Number((standardizedUnitPrice + priceStep).toFixed(2));
  }
  return {
    supplier: {
      id,
      demandId: demand.id,
      demandTitle: demand.title,
      unitPrice: input.unitPrice,
      pricingUnit: demand.pricingUnit,
      currency: "CNY",
      leadTime: input.leadTime,
      validDays: input.validDays,
      validUntil: validUntilDate.toISOString(),
      scopeNote: input.scopeNote,
      status: "已提交",
      createdAt,
    },
    normalized: {
      id,
      demandId: demand.id,
      demandTitle: demand.title,
      standardizedUnitPrice,
      pricingUnit: demand.pricingUnit,
      currency: "CNY",
      deliveryWindow: input.leadTime,
      validUntil: validUntilDate.toISOString(),
      standardizedScope: "KAI 统一口径：人民币、需求计价单位、含税及基础服务保障；供应方自由文本不向需求方展示。",
      standardizationVersion: "kai-standard-v1",
      standardizationNote: `按“${demand.pricingUnit}”使用 3% 平台标准化校准系数并归入价格档位；这不是供应方原始单价，交易前仍需人工复核税、电、网络与 SLA。`,
      status: "已标准化",
      createdAt,
    },
  };
}

export function draftRecord(input: CreateMarketplaceDraft): MarketplaceDraftRecord {
  return {
    id: createMarketplaceId("D"),
    title: input.title,
    category: input.category,
    capacity: input.capacity,
    status: "草稿",
    createdAt: new Date().toISOString(),
  };
}

declare global {
  var __kaiMarketplaceStorePromise: Promise<MarketplaceStore> | undefined;
}

async function resolveMarketplaceStore(): Promise<MarketplaceStore> {
  try {
    const cloudflare = await import("cloudflare:workers");
    const database = cloudflare.env.DB;
    if (database) {
      const { createD1MarketplaceStore } = await import("@/lib/server/marketplace-store-d1");
      return createD1MarketplaceStore(database);
    }
  } catch {
    // The direct Node deployment does not provide the Cloudflare runtime module.
  }

  const { createSqliteMarketplaceStore } = await import("@/lib/server/marketplace-store-sqlite");
  return createSqliteMarketplaceStore();
}

export function getMarketplaceStore() {
  globalThis.__kaiMarketplaceStorePromise ??= resolveMarketplaceStore().catch((error) => {
    globalThis.__kaiMarketplaceStorePromise = undefined;
    throw error;
  });
  return globalThis.__kaiMarketplaceStorePromise;
}
