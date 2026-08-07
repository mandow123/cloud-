import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementResultingChanges } from "node:sqlite";
import {
  isMarketplaceQuoteLeadTime,
  isMarketplaceRegion,
  type MarketplaceQuoteLeadTime,
  type MarketplaceRegion,
  type CreateMarketplaceDraft,
  type CreateMarketplaceQuote,
  type CreateMarketplaceRequest,
  type MarketplaceDraftRecord,
  type MarketplaceNormalizedQuoteRecord,
  type MarketplaceRequestRecord,
  type MarketplaceSupplierQuoteRecord,
  type MarketplaceSwapLeg,
  type PricingUnit,
  type ResourceCategory,
} from "@/lib/marketplace";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { resolveMarketplaceCapacityLimits } from "@/lib/server/marketplace-capacity";
import { CURATED_DEMAND_OWNER, curatedMarketDemands } from "@/lib/server/curated-market-demands";
import {
  MARKETPLACE_MIGRATION_CHECKSUM,
  MARKETPLACE_MIGRATION_VERSION,
  marketplaceDataRepairStatements,
  marketplaceLegacyImportStatements,
  marketplaceSchemaStatements,
} from "@/lib/server/marketplace-schema";
import {
  MarketplaceAccessError,
  MarketplaceCapacityError,
  MarketplaceDemandQuoteLimitError,
  MarketplaceIdempotencyConflictError,
  MarketplaceRateLimitError,
  MarketplaceStateConflictError,
} from "@/lib/server/marketplace-errors";
import {
  MARKETPLACE_RETENTION_DAYS,
  decodeMarketplaceCursor,
  draftRecord,
  marketplacePage,
  publicRequestRecord,
  quoteWriteRecord,
  requestRecord,
  type MarketplaceListOptions,
  type MarketplaceMutationContext,
  type MarketplaceStore,
} from "@/lib/server/marketplace-store";

const RATE_WINDOW_MS = 10 * 60 * 1_000;
const MAX_WRITES_PER_WINDOW = 30;
const MAINTENANCE_INTERVAL_MS = 15 * 60 * 1_000;

type RequestRow = {
  id: string;
  owner_actor_id: string;
  idempotency_key: string;
  payload_hash: string;
  visibility: "market";
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
  version: number;
};

type QuoteRow = {
  id: string;
  supplier_actor_id: string;
  request_owner_actor_id: string;
  idempotency_key: string;
  payload_hash: string;
  demand_id: string;
  demand_title: string;
  raw_unit_price: number;
  standardized_unit_price: number;
  pricing_unit: PricingUnit;
  currency: "CNY";
  lead_time: string;
  valid_days: number;
  valid_until: string;
  raw_scope_note: string;
  standardized_scope_note: string;
  standardization_version: string;
  standardization_note: string;
  supplier_status: "已提交";
  normalized_status: "已标准化";
  created_at: string;
};

type DraftRow = {
  id: string;
  owner_actor_id: string;
  idempotency_key: string;
  payload_hash: string;
  title: string;
  category: ResourceCategory;
  capacity: string;
  status: MarketplaceDraftRecord["status"];
  created_at: string;
};

function parseLeg(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as MarketplaceSwapLeg;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function regionFromRow(value: string): MarketplaceRegion {
  if (!isMarketplaceRegion(value)) throw new Error("DATABASE_UNSUPPORTED_MARKETPLACE_REGION");
  return value;
}

function leadTimeFromRow(value: string): MarketplaceQuoteLeadTime {
  if (!isMarketplaceQuoteLeadTime(value)) throw new Error("DATABASE_UNSUPPORTED_QUOTE_LEAD_TIME");
  return value;
}

function publicStandardizationText(value: string) {
  return value
    .replaceAll("演示", "平台参考")
    .replaceAll("虚构", "目录数据")
    .replaceAll("非实时成交价", "询价确认");
}

function mapRequest(row: RequestRow): MarketplaceRequestRecord {
  return {
    id: row.id,
    requestType: row.request_type,
    kind: row.kind,
    title: row.title,
    category: row.category,
    region: regionFromRow(row.region),
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

function mapSupplierQuote(row: QuoteRow): MarketplaceSupplierQuoteRecord {
  const superseded = row.standardization_version.includes("@superseded:");
  return {
    id: row.id,
    demandId: row.demand_id,
    demandTitle: row.demand_title,
    unitPrice: row.raw_unit_price,
    pricingUnit: row.pricing_unit,
    currency: row.currency,
    leadTime: leadTimeFromRow(row.lead_time),
    validDays: row.valid_days,
    validUntil: row.valid_until,
    scopeNote: row.raw_scope_note,
    status: superseded
      ? "需求已更新 · 需重新报价"
      : Date.parse(row.valid_until) <= Date.now() ? "已过期" : row.supplier_status,
    createdAt: row.created_at,
  };
}

function mapNormalizedQuote(row: QuoteRow): MarketplaceNormalizedQuoteRecord {
  const superseded = row.standardization_version.includes("@superseded:");
  return {
    id: row.id,
    demandId: row.demand_id,
    demandTitle: row.demand_title,
    standardizedUnitPrice: row.standardized_unit_price,
    pricingUnit: row.pricing_unit,
    currency: row.currency,
    deliveryWindow: leadTimeFromRow(row.lead_time),
    validUntil: row.valid_until,
    standardizedScope: publicStandardizationText(row.standardized_scope_note),
    standardizationVersion: "kai-standard-v1",
    standardizationNote: publicStandardizationText(row.standardization_note),
    status: superseded
      ? "需求已更新 · 需重新报价"
      : Date.parse(row.valid_until) <= Date.now() ? "已过期" : row.normalized_status,
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

function hasTable(db: DatabaseSync, table: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function applyMigration(db: DatabaseSync) {
  for (const statement of marketplaceSchemaStatements) db.exec(statement);
  const newest = db.prepare("SELECT version, checksum FROM marketplace_schema_migrations ORDER BY version DESC LIMIT 1").get() as
    | { version: number; checksum: string }
    | undefined;
  if (newest && newest.version > MARKETPLACE_MIGRATION_VERSION) {
    throw new Error(`DATABASE_SCHEMA_TOO_NEW:${newest.version}`);
  }
  if (newest?.version === MARKETPLACE_MIGRATION_VERSION) {
    if (newest.checksum !== MARKETPLACE_MIGRATION_CHECKSUM) throw new Error("DATABASE_MIGRATION_CHECKSUM_MISMATCH");
    return;
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    if (
      hasTable(db, "marketplace_requests")
      && hasTable(db, "marketplace_quotes")
      && hasTable(db, "marketplace_drafts")
    ) {
      for (const statement of marketplaceLegacyImportStatements) db.exec(statement);
    }
    for (const statement of marketplaceDataRepairStatements) db.exec(statement);
    db.prepare("INSERT INTO marketplace_schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)").run(
      MARKETPLACE_MIGRATION_VERSION,
      MARKETPLACE_MIGRATION_CHECKSUM,
      new Date().toISOString(),
    );
    db.exec(`PRAGMA user_version = ${MARKETPLACE_MIGRATION_VERSION}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function pruneExpiredMarketplaceData(db: DatabaseSync, sessionRowLimit: number) {
  const cutoff = new Date(Date.now() - MARKETPLACE_RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString();
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM marketplace_events_v2 WHERE created_at < ?").run(cutoff);
    db.prepare("DELETE FROM marketplace_quotes_v2 WHERE created_at < ?").run(cutoff);
    db.prepare("DELETE FROM marketplace_requests_v2 WHERE updated_at < ?").run(cutoff);
    db.prepare("DELETE FROM marketplace_drafts_v2 WHERE created_at < ?").run(cutoff);
    db.prepare("DELETE FROM marketplace_sessions_v2 WHERE expires_at <= ?").run(now);
    db.prepare(`DELETE FROM marketplace_sessions_v2 WHERE actor_id IN (
      SELECT actor_id FROM marketplace_sessions_v2
      ORDER BY last_seen_at DESC LIMIT -1 OFFSET ?
    )`).run(sessionRowLimit);
    db.prepare("DELETE FROM marketplace_write_limits_v2 WHERE updated_at < ?").run(cutoff);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function upsertCuratedMarketDemands(db: DatabaseSync) {
  const appliedAt = new Date().toISOString();
  const statement = db.prepare(`INSERT INTO marketplace_requests_v2 (
    id, owner_actor_id, idempotency_key, payload_hash, visibility,
    request_type, kind, title, category, region, pricing_unit, quantity,
    duration_hours, delivery_date, summary, offered_json, wanted_json,
    cash_direction, cash_amount, status, created_at, updated_at, version
  ) VALUES (?, ?, ?, ?, 'market', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'none', NULL, ?, ?, ?, 1)
  ON CONFLICT(id) DO UPDATE SET
    payload_hash = excluded.payload_hash,
    kind = excluded.kind,
    title = excluded.title,
    category = excluded.category,
    region = excluded.region,
    pricing_unit = excluded.pricing_unit,
    quantity = excluded.quantity,
    duration_hours = excluded.duration_hours,
    delivery_date = excluded.delivery_date,
    summary = excluded.summary,
    status = excluded.status,
    updated_at = CASE
      WHEN marketplace_requests_v2.updated_at > ? THEN marketplace_requests_v2.updated_at
      ELSE ?
    END,
    version = marketplace_requests_v2.version + 1
  WHERE marketplace_requests_v2.owner_actor_id = ?
    AND (marketplace_requests_v2.payload_hash <> excluded.payload_hash
      OR marketplace_requests_v2.kind <> excluded.kind
      OR marketplace_requests_v2.title <> excluded.title
      OR marketplace_requests_v2.category <> excluded.category
      OR marketplace_requests_v2.region <> excluded.region
      OR marketplace_requests_v2.pricing_unit <> excluded.pricing_unit
      OR marketplace_requests_v2.quantity <> excluded.quantity
      OR marketplace_requests_v2.duration_hours IS NOT excluded.duration_hours
      OR marketplace_requests_v2.delivery_date IS NOT excluded.delivery_date
      OR marketplace_requests_v2.summary <> excluded.summary)`);
  const supersedeQuotes = db.prepare(`UPDATE marketplace_quotes_v2
    SET valid_until = CASE WHEN valid_until > ? THEN ? ELSE valid_until END,
        standardization_version = CASE
          WHEN standardization_version LIKE 'kai-standard-v1@revision:%'
            THEN standardization_version || '@superseded:' || ?
          ELSE 'kai-standard-v1@revision:legacy@superseded:' || ?
        END
    WHERE demand_id = ?
      AND standardization_version NOT LIKE '%@superseded:%'
      AND standardization_version <> 'kai-standard-v1@revision:' || ?
      AND EXISTS (
        SELECT 1 FROM marketplace_requests_v2
        WHERE id = ? AND owner_actor_id = ? AND payload_hash = ?
      )`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const demand of curatedMarketDemands()) {
      statement.run(
        demand.id,
        demand.ownerActorId,
        demand.idempotencyKey,
        demand.payloadHash,
        demand.requestType,
        demand.kind,
        demand.title,
        demand.category,
        demand.region,
        demand.pricingUnit,
        demand.quantity,
        demand.durationHours,
        demand.deliveryDate,
        demand.summary,
        demand.status,
        demand.createdAt,
        demand.updatedAt,
        appliedAt,
        appliedAt,
        CURATED_DEMAND_OWNER,
      );
      supersedeQuotes.run(
        appliedAt,
        appliedAt,
        appliedAt,
        appliedAt,
        demand.id,
        demand.payloadHash,
        demand.id,
        CURATED_DEMAND_OWNER,
        demand.payloadHash,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function openDatabase(sessionRowLimit: number,businessMaintenance=true) {
  const dataDirectory = process.env.KAI_DB_DIR
    || process.env.KAI_DATA_DIR
    || join(process.cwd(), ".market-cache", "marketplace");
  const databasePath = join(dataDirectory, "kai-cloud.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA wal_autocheckpoint = 1000");
  applyMigration(db);
  if(businessMaintenance){pruneExpiredMarketplaceData(db, sessionRowLimit);upsertCuratedMarketDemands(db);}
  return db;
}

type SqlValue = string | number | null;

async function cursorSql(options: MarketplaceListOptions, values: SqlValue[], audience: string) {
  const cursor = await decodeMarketplaceCursor(options.cursor, audience);
  if (!cursor) return "";
  values.push(cursor.createdAt, cursor.createdAt, cursor.id);
  return " AND (created_at < ? OR (created_at = ? AND id < ?))";
}

function existingRequestByIdempotency(db: DatabaseSync, context: MarketplaceMutationContext) {
  return db.prepare("SELECT * FROM marketplace_requests_v2 WHERE owner_actor_id = ? AND idempotency_key = ?")
    .get(context.actorId, context.idempotencyKey) as RequestRow | undefined;
}

function existingQuoteByIdempotency(db: DatabaseSync, context: MarketplaceMutationContext) {
  return db.prepare("SELECT * FROM marketplace_quotes_v2 WHERE supplier_actor_id = ? AND idempotency_key = ?")
    .get(context.actorId, context.idempotencyKey) as QuoteRow | undefined;
}

function existingDraftByIdempotency(db: DatabaseSync, context: MarketplaceMutationContext) {
  return db.prepare("SELECT * FROM marketplace_drafts_v2 WHERE owner_actor_id = ? AND idempotency_key = ?")
    .get(context.actorId, context.idempotencyKey) as DraftRow | undefined;
}

function replayOrConflict<Row extends { payload_hash: string }, Record>(row: Row | undefined, hash: string, mapper: (row: Row) => Record) {
  if (!row) return null;
  if (row.payload_hash !== hash) throw new MarketplaceIdempotencyConflictError();
  return { record: mapper(row), replayed: true } as const;
}

function insertEvent(db: DatabaseSync, actorId: string, entityType: string, entityId: string, eventType: string, summary: string, createdAt: string) {
  db.prepare(`INSERT INTO marketplace_events_v2 (
    id, actor_id, entity_type, entity_id, event_type, summary, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    `KAI-E-${createdAt.slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`,
    actorId,
    entityType,
    entityId,
    eventType,
    summary,
    createdAt,
  );
}

export function createSqliteMarketplaceStore(options:{readinessOnly?:boolean}={}): MarketplaceStore {
  const capacityLimits = resolveMarketplaceCapacityLimits();
  const db = openDatabase(capacityLimits.sessions,!options.readinessOnly);
  let nextMaintenanceAt = Date.now() + MAINTENANCE_INTERVAL_MS;

  function maintainIfDue() {
    if(options.readinessOnly)return;
    if (Date.now() < nextMaintenanceAt) return;
    nextMaintenanceAt = Date.now() + MAINTENANCE_INTERVAL_MS;
    pruneExpiredMarketplaceData(db, capacityLimits.sessions);
    upsertCuratedMarketDemands(db);
  }

  return {
    close(){db.close();},
    async establishSession(actor: MarketplaceActor) {
      maintainIfDue();
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const existing = db.prepare("SELECT 1 AS found FROM marketplace_sessions_v2 WHERE actor_id = ?")
          .get(actor.id) as { found: number } | undefined;
        if (!existing) {
          const count = db.prepare("SELECT COUNT(*) AS count FROM marketplace_sessions_v2").get() as { count: number };
          if (count.count >= capacityLimits.sessions) throw new MarketplaceCapacityError("sessions");
        }
        db.prepare(`INSERT INTO marketplace_sessions_v2 (
          actor_id, session_hash, source, created_at, last_seen_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(actor_id) DO UPDATE SET
          session_hash = excluded.session_hash,
          source = excluded.source,
          last_seen_at = excluded.last_seen_at,
          expires_at = excluded.expires_at`).run(
          actor.id,
          actor.sessionHash,
          actor.source,
          now,
          now,
          actor.expiresAt,
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async touchSession(actor: MarketplaceActor) {
      const result = db.prepare(`UPDATE marketplace_sessions_v2
        SET last_seen_at = ?, expires_at = ?
        WHERE actor_id = ? AND session_hash = ? AND expires_at > ?`).run(
        new Date().toISOString(),
        actor.expiresAt,
        actor.id,
        actor.sessionHash,
        new Date().toISOString(),
      ) as StatementResultingChanges;
      return Number(result.changes) === 1;
    },
    async consumeWriteAllowance(actorId, routeScope) {
      maintainIfDue();
      const now = Date.now();
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = db.prepare(`SELECT window_started_at, write_count
          FROM marketplace_write_limits_v2 WHERE actor_id = ? AND route_scope = ?`).get(actorId, routeScope) as
          | { window_started_at: number; write_count: number }
          | undefined;
        if (!row || row.window_started_at + RATE_WINDOW_MS <= now) {
          db.prepare(`INSERT INTO marketplace_write_limits_v2 (
            actor_id, route_scope, window_started_at, write_count, updated_at
          ) VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(actor_id, route_scope) DO UPDATE SET
            window_started_at = excluded.window_started_at,
            write_count = 1,
            updated_at = excluded.updated_at`).run(actorId, routeScope, now, new Date(now).toISOString());
        } else if (row.write_count >= MAX_WRITES_PER_WINDOW) {
          throw new MarketplaceRateLimitError(Math.max(1, Math.ceil((row.window_started_at + RATE_WINDOW_MS - now) / 1_000)));
        } else {
          db.prepare(`UPDATE marketplace_write_limits_v2
            SET write_count = write_count + 1, updated_at = ?
            WHERE actor_id = ? AND route_scope = ?`).run(new Date(now).toISOString(), actorId, routeScope);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async listOwnedRequests(actorId, options) {
      maintainIfDue();
      const values: SqlValue[] = [actorId];
      const audience = `requests:mine:${actorId}`;
      const cursor = await cursorSql(options, values, audience);
      values.push(options.limit + 1);
      const rows = db.prepare(`SELECT * FROM marketplace_requests_v2
        WHERE owner_actor_id = ?${cursor}
        ORDER BY created_at DESC, id DESC LIMIT ?`).all(...values) as RequestRow[];
      return marketplacePage(rows.map(mapRequest), options.limit, audience);
    },
    async listPublicRequests(options) {
      maintainIfDue();
      const values: SqlValue[] = [];
      const audience = "requests:market";
      const cursor = await cursorSql(options, values, audience);
      values.push(options.limit + 1);
      const rows = db.prepare(`SELECT * FROM marketplace_requests_v2
        WHERE visibility = 'market'${cursor}
        ORDER BY created_at DESC, id DESC LIMIT ?`).all(...values) as RequestRow[];
      return marketplacePage(rows.map(mapRequest).map(publicRequestRecord), options.limit, audience);
    },
    async createRequest(context, input: CreateMarketplaceRequest) {
      const replay = replayOrConflict(existingRequestByIdempotency(db, context), context.payloadHash, mapRequest);
      if (replay) return replay;
      const record = requestRecord(input);
      db.exec("BEGIN IMMEDIATE");
      try {
        const insideReplay = replayOrConflict(existingRequestByIdempotency(db, context), context.payloadHash, mapRequest);
        if (insideReplay) {
          db.exec("COMMIT");
          return insideReplay;
        }
        const count = db.prepare("SELECT COUNT(*) AS count FROM marketplace_requests_v2 WHERE owner_actor_id <> ?")
          .get(CURATED_DEMAND_OWNER) as { count: number };
        if (count.count >= capacityLimits.requests) throw new MarketplaceCapacityError("requests");
        db.prepare(`INSERT INTO marketplace_requests_v2 (
          id, owner_actor_id, idempotency_key, payload_hash, visibility,
          request_type, kind, title, category, region, pricing_unit, quantity,
          duration_hours, delivery_date, summary, offered_json, wanted_json,
          cash_direction, cash_amount, status, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, 'market', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
          record.id,
          context.actorId,
          context.idempotencyKey,
          context.payloadHash,
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
        insertEvent(db, context.actorId, "request", record.id, "REQUEST_CREATED", "需求已记录并生成匿名市场投影。", record.createdAt);
        db.exec("COMMIT");
        return { record, replayed: false };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async listBuyerNormalizedQuotes(actorId, options) {
      maintainIfDue();
      const values: SqlValue[] = [actorId];
      const audience = `quotes:buyer:${actorId}`;
      const cursor = await cursorSql(options, values, audience);
      values.push(options.limit + 1);
      const rows = db.prepare(`SELECT * FROM marketplace_quotes_v2
        WHERE request_owner_actor_id = ?${cursor}
        ORDER BY created_at DESC, id DESC LIMIT ?`).all(...values) as QuoteRow[];
      return marketplacePage(rows.map(mapNormalizedQuote), options.limit, audience);
    },
    async listSupplierQuotes(actorId, options) {
      maintainIfDue();
      const values: SqlValue[] = [actorId];
      const audience = `quotes:supplier:${actorId}`;
      const cursor = await cursorSql(options, values, audience);
      values.push(options.limit + 1);
      const rows = db.prepare(`SELECT * FROM marketplace_quotes_v2
        WHERE supplier_actor_id = ?${cursor}
        ORDER BY created_at DESC, id DESC LIMIT ?`).all(...values) as QuoteRow[];
      return marketplacePage(rows.map(mapSupplierQuote), options.limit, audience);
    },
    async createQuote(context, input: CreateMarketplaceQuote) {
      const replay = replayOrConflict(existingQuoteByIdempotency(db, context), context.payloadHash, mapSupplierQuote);
      if (replay) return replay;
      const initialDemand = db.prepare("SELECT * FROM marketplace_requests_v2 WHERE id = ? AND visibility = 'market'")
        .get(input.demandId) as RequestRow | undefined;
      if (!initialDemand) throw new MarketplaceAccessError("DEMAND_NOT_AVAILABLE");
      const records = quoteWriteRecord(input, mapRequest(initialDemand));
      db.exec("BEGIN IMMEDIATE");
      try {
        const insideReplay = replayOrConflict(existingQuoteByIdempotency(db, context), context.payloadHash, mapSupplierQuote);
        if (insideReplay) {
          db.exec("COMMIT");
          return insideReplay;
        }
        const demand = db.prepare("SELECT * FROM marketplace_requests_v2 WHERE id = ? AND visibility = 'market'")
          .get(input.demandId) as RequestRow | undefined;
        if (!demand) throw new MarketplaceAccessError("DEMAND_NOT_AVAILABLE");
        const demandQuoteCount = db.prepare(`SELECT COUNT(*) AS count FROM marketplace_quotes_v2
          WHERE demand_id = ? AND valid_until > ? AND standardization_version NOT LIKE '%@superseded:%'`)
          .get(demand.id, records.supplier.createdAt) as { count: number };
        if (demandQuoteCount.count >= capacityLimits.quotesPerDemand) throw new MarketplaceDemandQuoteLimitError();
        const quoteCount = db.prepare("SELECT COUNT(*) AS count FROM marketplace_quotes_v2").get() as { count: number };
        if (quoteCount.count >= capacityLimits.quotes) throw new MarketplaceCapacityError("quotes");
        db.prepare(`INSERT INTO marketplace_quotes_v2 (
          id, supplier_actor_id, request_owner_actor_id, idempotency_key, payload_hash,
          demand_id, demand_title, raw_unit_price, standardized_unit_price,
          pricing_unit, currency, lead_time, valid_days, valid_until,
          raw_scope_note, standardized_scope_note, standardization_version,
          standardization_note, supplier_status, normalized_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          records.supplier.id,
          context.actorId,
          demand.owner_actor_id,
          context.idempotencyKey,
          context.payloadHash,
          records.supplier.demandId,
          records.supplier.demandTitle,
          records.supplier.unitPrice,
          records.normalized.standardizedUnitPrice,
          records.supplier.pricingUnit,
          records.supplier.currency,
          records.supplier.leadTime,
          records.supplier.validDays,
          records.supplier.validUntil,
          records.supplier.scopeNote,
          records.normalized.standardizedScope,
          `kai-standard-v1@revision:${demand.payload_hash}`,
          records.normalized.standardizationNote,
          records.supplier.status,
          records.normalized.status,
          records.supplier.createdAt,
        );
        const updated = db.prepare(`UPDATE marketplace_requests_v2
          SET status = '方案待确认',
              updated_at = CASE WHEN updated_at > ? THEN updated_at ELSE ? END,
              version = version + 1
          WHERE id = ? AND version = ?`).run(
            records.supplier.createdAt,
            records.supplier.createdAt,
            demand.id,
            demand.version,
          ) as StatementResultingChanges;
        if (Number(updated.changes) !== 1) throw new MarketplaceStateConflictError();
        insertEvent(db, context.actorId, "request", demand.id, "QUOTE_SUBMITTED", "供应方已提交一条原始报价。", records.supplier.createdAt);
        insertEvent(db, "system:kai", "request", demand.id, "QUOTE_STANDARDIZED", "KAI 已生成需求方可见的标准化方案。", records.supplier.createdAt);
        db.exec("COMMIT");
        return { record: records.supplier, replayed: false };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async listOwnedDrafts(actorId, options) {
      maintainIfDue();
      const values: SqlValue[] = [actorId];
      const audience = `drafts:mine:${actorId}`;
      const cursor = await cursorSql(options, values, audience);
      values.push(options.limit + 1);
      const rows = db.prepare(`SELECT * FROM marketplace_drafts_v2
        WHERE owner_actor_id = ?${cursor}
        ORDER BY created_at DESC, id DESC LIMIT ?`).all(...values) as DraftRow[];
      return marketplacePage(rows.map(mapDraft), options.limit, audience);
    },
    async createDraft(context, input: CreateMarketplaceDraft) {
      const replay = replayOrConflict(existingDraftByIdempotency(db, context), context.payloadHash, mapDraft);
      if (replay) return replay;
      const record = draftRecord(input);
      db.exec("BEGIN IMMEDIATE");
      try {
        const insideReplay = replayOrConflict(existingDraftByIdempotency(db, context), context.payloadHash, mapDraft);
        if (insideReplay) {
          db.exec("COMMIT");
          return insideReplay;
        }
        const count = db.prepare("SELECT COUNT(*) AS count FROM marketplace_drafts_v2").get() as { count: number };
        if (count.count >= capacityLimits.drafts) throw new MarketplaceCapacityError("drafts");
        db.prepare(`INSERT INTO marketplace_drafts_v2 (
          id, owner_actor_id, idempotency_key, payload_hash,
          title, category, capacity, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          record.id,
          context.actorId,
          context.idempotencyKey,
          context.payloadHash,
          record.title,
          record.category,
          record.capacity,
          record.status,
          record.createdAt,
        );
        insertEvent(db, context.actorId, "draft", record.id, "DRAFT_SAVED", "供应方资源草稿已保存。", record.createdAt);
        db.exec("COMMIT");
        return { record, replayed: false };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async health() {
      maintainIfDue();
      const integrity = db.prepare("PRAGMA quick_check(1)").get() as { quick_check: string };
      if (integrity.quick_check !== "ok") throw new Error("SQLITE_INTEGRITY_CHECK_FAILED");
      const migration = db.prepare("SELECT version, checksum FROM marketplace_schema_migrations ORDER BY version DESC LIMIT 1").get() as
        | { version: number; checksum: string }
        | undefined;
      if (migration?.version !== MARKETPLACE_MIGRATION_VERSION || migration.checksum !== MARKETPLACE_MIGRATION_CHECKSUM) {
        throw new Error("DATABASE_MIGRATION_NOT_READY");
      }
      const requests = db.prepare("SELECT COUNT(*) AS count FROM marketplace_requests_v2").get() as { count: number };
      const quotes = db.prepare("SELECT COUNT(*) AS count FROM marketplace_quotes_v2").get() as { count: number };
      const drafts = db.prepare("SELECT COUNT(*) AS count FROM marketplace_drafts_v2").get() as { count: number };
      const events = db.prepare("SELECT COUNT(*) AS count FROM marketplace_events_v2").get() as { count: number };
      return {
        backend: "sqlite",
        schemaVersion: migration.version,
        integrity: "ok",
        requests: requests.count,
        quotes: quotes.count,
        drafts: drafts.count,
        events: events.count,
      };
    },
  };
}
