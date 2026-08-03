import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

function parseLeg(value: string | null) {
  return value ? (JSON.parse(value) as MarketplaceSwapLeg) : null;
}

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
    offered: parseLeg(row.offered_json),
    wanted: parseLeg(row.wanted_json),
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

function openDatabase() {
  const dataDirectory = process.env.KAI_DATA_DIR || join(process.cwd(), ".market-cache", "marketplace");
  const databasePath = join(dataDirectory, "kai-cloud.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  for (const statement of marketplaceSchemaStatements) db.exec(statement);
  return db;
}

export function createSqliteMarketplaceStore(): MarketplaceStore {
  const db = openDatabase();

  return {
    async listRequests(limit) {
      return (db.prepare("SELECT * FROM marketplace_requests ORDER BY created_at DESC LIMIT ?").all(clampLimit(limit)) as RequestRow[]).map(mapRequest);
    },
    async createRequest(input: CreateMarketplaceRequest) {
      const record = requestRecord(input);
      db.prepare(`INSERT INTO marketplace_requests (
        id, request_type, kind, title, category, region, pricing_unit, quantity,
        duration_hours, delivery_date, summary, offered_json, wanted_json,
        cash_direction, cash_amount, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
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
      );
      return record;
    },
    async listQuotes(limit) {
      return (db.prepare("SELECT * FROM marketplace_quotes ORDER BY created_at DESC LIMIT ?").all(clampLimit(limit)) as QuoteRow[]).map(mapQuote);
    },
    async createQuote(input: CreateMarketplaceQuote) {
      const demandRow = db.prepare("SELECT * FROM marketplace_requests WHERE id = ?").get(input.demandId) as RequestRow | undefined;
      if (!demandRow) throw new Error("DEMAND_NOT_FOUND");
      const demand = mapRequest(demandRow);
      const record = quoteRecord(input, demand);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`INSERT INTO marketplace_quotes (
          id, demand_id, demand_title, unit_price, pricing_unit, lead_time,
          valid_days, scope_note, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
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
        );
        db.prepare("UPDATE marketplace_requests SET status = ?, updated_at = ? WHERE id = ?").run(
          "报价已收到",
          record.createdAt,
          record.demandId,
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return record;
    },
    async listDrafts(limit) {
      return (db.prepare("SELECT * FROM marketplace_drafts ORDER BY created_at DESC LIMIT ?").all(clampLimit(limit)) as DraftRow[]).map(mapDraft);
    },
    async createDraft(input: CreateMarketplaceDraft) {
      const record = draftRecord(input);
      db.prepare("INSERT INTO marketplace_drafts (id, title, category, capacity, status, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        record.id,
        record.title,
        record.category,
        record.capacity,
        record.status,
        record.createdAt,
      );
      return record;
    },
    async health() {
      const requests = db.prepare("SELECT COUNT(*) AS count FROM marketplace_requests").get() as { count: number };
      const quotes = db.prepare("SELECT COUNT(*) AS count FROM marketplace_quotes").get() as { count: number };
      const drafts = db.prepare("SELECT COUNT(*) AS count FROM marketplace_drafts").get() as { count: number };
      return { backend: "sqlite", requests: requests.count, quotes: quotes.count, drafts: drafts.count };
    },
  };
}
