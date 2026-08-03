import type {
  CreateMarketplaceDraft,
  CreateMarketplaceQuote,
  CreateMarketplaceRequest,
  MarketplaceDraftRecord,
  MarketplaceQuoteRecord,
  MarketplaceRequestRecord,
  MarketplaceSwapLeg,
  PricingUnit,
  ResourceCategory,
} from "@/lib/marketplace";
import { marketplaceSchemaStatements } from "@/lib/server/marketplace-schema";
import {
  draftRecord,
  quoteRecord,
  requestRecord,
  type MarketplaceStore,
} from "@/lib/server/marketplace-store";

type D1Result<T> = { results?: T[]; success?: boolean };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
};
type D1Database = {
  prepare(sql: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<Array<D1Result<T>>>;
};

type RequestRow = {
  id: string;
  request_type: "procurement" | "swap";
  kind: MarketplaceRequestRecord["kind"];
  title: string;
  category: ResourceCategory;
  region: string;
  pricing_unit: PricingUnit;
  quantity: number;
  duration_hours: number | null;
  delivery_date: string | null;
  summary: string;
  offered_json: string | null;
  wanted_json: string | null;
  cash_direction: MarketplaceRequestRecord["cashDirection"];
  cash_amount: number | null;
  status: MarketplaceRequestRecord["status"];
  created_at: string;
  updated_at: string;
};

type QuoteRow = {
  id: string;
  demand_id: string;
  demand_title: string;
  unit_price: number;
  pricing_unit: PricingUnit;
  lead_time: string;
  valid_days: number;
  scope_note: string;
  status: MarketplaceQuoteRecord["status"];
  created_at: string;
};

type DraftRow = {
  id: string;
  title: string;
  category: ResourceCategory;
  capacity: string;
  status: MarketplaceDraftRecord["status"];
  created_at: string;
};

function mapRequest(row: RequestRow): MarketplaceRequestRecord {
  return {
    id: row.id,
    requestType: row.request_type,
    kind: row.kind,
    title: row.title,
    category: row.category,
    region: row.region,
    pricingUnit: row.pricing_unit,
    quantity: row.quantity,
    durationHours: row.duration_hours,
    deliveryDate: row.delivery_date,
    summary: row.summary,
    offered: row.offered_json ? (JSON.parse(row.offered_json) as MarketplaceSwapLeg) : null,
    wanted: row.wanted_json ? (JSON.parse(row.wanted_json) as MarketplaceSwapLeg) : null,
    cashDirection: row.cash_direction,
    cashAmount: row.cash_amount,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapQuote(row: QuoteRow): MarketplaceQuoteRecord {
  return {
    id: row.id,
    demandId: row.demand_id,
    demandTitle: row.demand_title,
    unitPrice: row.unit_price,
    pricingUnit: row.pricing_unit,
    leadTime: row.lead_time,
    validDays: row.valid_days,
    scopeNote: row.scope_note,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapDraft(row: DraftRow): MarketplaceDraftRecord {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    capacity: row.capacity,
    status: row.status,
    createdAt: row.created_at,
  };
}

function clampLimit(limit = 50) {
  return Math.max(1, Math.min(100, Math.trunc(limit)));
}

export function createD1MarketplaceStore(value: unknown): MarketplaceStore {
  const db = value as D1Database;
  let schemaPromise: Promise<void> | undefined;
  const ensureSchema = () => {
    schemaPromise ??= db.batch(marketplaceSchemaStatements.map((sql) => db.prepare(sql))).then(() => undefined);
    return schemaPromise;
  };

  return {
    async listRequests(limit) {
      await ensureSchema();
      const result = await db.prepare("SELECT * FROM marketplace_requests ORDER BY created_at DESC LIMIT ?").bind(clampLimit(limit)).all<RequestRow>();
      return (result.results ?? []).map(mapRequest);
    },
    async createRequest(input: CreateMarketplaceRequest) {
      await ensureSchema();
      const record = requestRecord(input);
      await db.prepare(`INSERT INTO marketplace_requests (
        id, request_type, kind, title, category, region, pricing_unit, quantity,
        duration_hours, delivery_date, summary, offered_json, wanted_json,
        cash_direction, cash_amount, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        record.id,
        record.requestType,
        record.kind,
        record.title,
        record.category,
        record.region,
        record.pricingUnit,
        record.quantity,
        record.durationHours,
        record.deliveryDate,
        record.summary,
        record.offered ? JSON.stringify(record.offered) : null,
        record.wanted ? JSON.stringify(record.wanted) : null,
        record.cashDirection,
        record.cashAmount,
        record.status,
        record.createdAt,
        record.updatedAt,
      ).run();
      return record;
    },
    async listQuotes(limit) {
      await ensureSchema();
      const result = await db.prepare("SELECT * FROM marketplace_quotes ORDER BY created_at DESC LIMIT ?").bind(clampLimit(limit)).all<QuoteRow>();
      return (result.results ?? []).map(mapQuote);
    },
    async createQuote(input: CreateMarketplaceQuote) {
      await ensureSchema();
      const demandRow = await db.prepare("SELECT * FROM marketplace_requests WHERE id = ?").bind(input.demandId).first<RequestRow>();
      if (!demandRow) throw new Error("DEMAND_NOT_FOUND");
      const record = quoteRecord(input, mapRequest(demandRow));
      await db.batch([
        db.prepare(`INSERT INTO marketplace_quotes (
          id, demand_id, demand_title, unit_price, pricing_unit, lead_time,
          valid_days, scope_note, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          record.id,
          record.demandId,
          record.demandTitle,
          record.unitPrice,
          record.pricingUnit,
          record.leadTime,
          record.validDays,
          record.scopeNote,
          record.status,
          record.createdAt,
        ),
        db.prepare("UPDATE marketplace_requests SET status = ?, updated_at = ? WHERE id = ?").bind(
          "报价已收到",
          record.createdAt,
          record.demandId,
        ),
      ]);
      return record;
    },
    async listDrafts(limit) {
      await ensureSchema();
      const result = await db.prepare("SELECT * FROM marketplace_drafts ORDER BY created_at DESC LIMIT ?").bind(clampLimit(limit)).all<DraftRow>();
      return (result.results ?? []).map(mapDraft);
    },
    async createDraft(input: CreateMarketplaceDraft) {
      await ensureSchema();
      const record = draftRecord(input);
      await db.prepare("INSERT INTO marketplace_drafts (id, title, category, capacity, status, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
        record.id,
        record.title,
        record.category,
        record.capacity,
        record.status,
        record.createdAt,
      ).run();
      return record;
    },
    async health() {
      await ensureSchema();
      const [requests, quotes, drafts] = await Promise.all([
        db.prepare("SELECT COUNT(*) AS count FROM marketplace_requests").first<{ count: number }>(),
        db.prepare("SELECT COUNT(*) AS count FROM marketplace_quotes").first<{ count: number }>(),
        db.prepare("SELECT COUNT(*) AS count FROM marketplace_drafts").first<{ count: number }>(),
      ]);
      return {
        backend: "d1",
        requests: requests?.count ?? 0,
        quotes: quotes?.count ?? 0,
        drafts: drafts?.count ?? 0,
      };
    },
  };
}
