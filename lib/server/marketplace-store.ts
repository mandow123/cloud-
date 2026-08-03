import {
  createMarketplaceId,
  type CreateMarketplaceDraft,
  type CreateMarketplaceQuote,
  type CreateMarketplaceRequest,
  type MarketplaceDraftRecord,
  type MarketplaceQuoteRecord,
  type MarketplaceRequestRecord,
} from "@/lib/marketplace";

export type MarketplaceStoreHealth = {
  backend: "sqlite" | "d1";
  requests: number;
  quotes: number;
  drafts: number;
};

export interface MarketplaceStore {
  listRequests(limit?: number): Promise<MarketplaceRequestRecord[]>;
  createRequest(input: CreateMarketplaceRequest): Promise<MarketplaceRequestRecord>;
  listQuotes(limit?: number): Promise<MarketplaceQuoteRecord[]>;
  createQuote(input: CreateMarketplaceQuote): Promise<MarketplaceQuoteRecord>;
  listDrafts(limit?: number): Promise<MarketplaceDraftRecord[]>;
  createDraft(input: CreateMarketplaceDraft): Promise<MarketplaceDraftRecord>;
  health(): Promise<MarketplaceStoreHealth>;
}

const categoryLabel = {
  gpu: "GPU 算力",
  token_model: "Token / 模型",
  rack_capacity: "整机柜 / 容量",
  cloud_vendor: "云厂商资源",
} as const;

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

export function quoteRecord(
  input: CreateMarketplaceQuote,
  demand: MarketplaceRequestRecord,
): MarketplaceQuoteRecord {
  return {
    id: createMarketplaceId("Q"),
    demandId: demand.id,
    demandTitle: demand.title,
    unitPrice: input.unitPrice,
    pricingUnit: demand.pricingUnit,
    leadTime: input.leadTime,
    validDays: input.validDays,
    scopeNote: input.scopeNote,
    status: "已提交",
    createdAt: new Date().toISOString(),
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
  globalThis.__kaiMarketplaceStorePromise ??= resolveMarketplaceStore();
  return globalThis.__kaiMarketplaceStorePromise;
}
