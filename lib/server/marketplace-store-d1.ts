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
  marketplaceRegionExpansionStatements,
  marketplaceVisibilityExpansionStatements,
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

type D1Result<T> = { results?: T[]; success?: boolean; meta?: { changes?: number } };
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
  owner_actor_id: string;
  idempotency_key: string;
  payload_hash: string;
  visibility: "private" | "market";
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

type EventDependency = Readonly<{
  kind: "request" | "quote" | "draft";
  id: string;
}>;

function eventStatement(
  db: D1Database,
  actorId: string,
  entityType: string,
  entityId: string,
  eventType: string,
  summary: string,
  createdAt: string,
  dependency?: EventDependency,
) {
  const id = `KAI-E-${createdAt.slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
  const dependencyTable = dependency?.kind === "request"
    ? "marketplace_requests_v2"
    : dependency?.kind === "quote"
      ? "marketplace_quotes_v2"
      : dependency?.kind === "draft"
        ? "marketplace_drafts_v2"
        : null;
  const statement = db.prepare(`INSERT INTO marketplace_events_v2 (
    id, actor_id, entity_type, entity_id, event_type, summary, created_at
  ) SELECT ?, ?, ?, ?, ?, ?, ?${dependencyTable ? `
    WHERE EXISTS (SELECT 1 FROM ${dependencyTable} WHERE id = ?)` : ""}`);
  return dependencyTable && dependency
    ? statement.bind(id, actorId, entityType, entityId, eventType, summary, createdAt, dependency.id)
    : statement.bind(id, actorId, entityType, entityId, eventType, summary, createdAt);
}

function d1Changes(result: D1Result<unknown> | undefined, operation: string) {
  const changes = result?.meta?.changes;
  if (!Number.isInteger(changes) || (changes ?? -1) < 0) throw new Error(`D1_CHANGES_UNAVAILABLE:${operation}`);
  return changes as number;
}

async function cursorFragment(options: MarketplaceListOptions, values: unknown[], audience: string) {
  const cursor = await decodeMarketplaceCursor(options.cursor, audience);
  if (!cursor) return "";
  values.push(cursor.createdAt, cursor.createdAt, cursor.id);
  return " AND (created_at < ? OR (created_at = ? AND id < ?))";
}

function replayOrConflict<Row extends { payload_hash: string }, Record>(row: Row | null, hash: string, mapper: (row: Row) => Record) {
  if (!row) return null;
  if (row.payload_hash !== hash) throw new MarketplaceIdempotencyConflictError();
  return { record: mapper(row), replayed: true } as const;
}

export function createD1MarketplaceStore(value: unknown,options:{readinessOnly?:boolean}={}): MarketplaceStore {
  const db = value as D1Database;
  const capacityLimits = resolveMarketplaceCapacityLimits();
  let schemaPromise: Promise<void> | undefined;
  let nextMaintenanceAt = 0;
  const upsertCuratedMarketDemands = async () => {
    const appliedAt = new Date().toISOString();
    await db.batch(curatedMarketDemands().flatMap((demand) => [db.prepare(`INSERT INTO marketplace_requests_v2 (
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
        OR marketplace_requests_v2.summary <> excluded.summary)`).bind(
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
      ), db.prepare(`UPDATE marketplace_quotes_v2
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
          )`).bind(
            appliedAt,
            appliedAt,
            appliedAt,
            appliedAt,
            demand.id,
            demand.payloadHash,
            demand.id,
            CURATED_DEMAND_OWNER,
            demand.payloadHash,
          )]));
  };
  const pruneExpiredMarketplaceData = async (force = false) => {
    if (!force && Date.now() < nextMaintenanceAt) return;
    nextMaintenanceAt = Date.now() + MAINTENANCE_INTERVAL_MS;
    const cutoff = new Date(Date.now() - MARKETPLACE_RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString();
    const now = new Date().toISOString();
    await db.batch([
      db.prepare("DELETE FROM marketplace_events_v2 WHERE created_at < ?").bind(cutoff),
      db.prepare("DELETE FROM marketplace_quotes_v2 WHERE created_at < ?").bind(cutoff),
      db.prepare("DELETE FROM marketplace_requests_v2 WHERE updated_at < ?").bind(cutoff),
      db.prepare("DELETE FROM marketplace_drafts_v2 WHERE created_at < ?").bind(cutoff),
      db.prepare("DELETE FROM marketplace_sessions_v2 WHERE expires_at <= ?").bind(now),
      db.prepare(`DELETE FROM marketplace_sessions_v2 WHERE actor_id IN (
        SELECT actor_id FROM marketplace_sessions_v2
        ORDER BY last_seen_at DESC LIMIT -1 OFFSET ?
      )`).bind(capacityLimits.sessions),
      db.prepare("DELETE FROM marketplace_write_limits_v2 WHERE updated_at < ?").bind(cutoff),
    ]);
    await upsertCuratedMarketDemands();
  };
  const ensureSchema = () => {
    schemaPromise ??= (async () => {
      await db.batch(marketplaceSchemaStatements.map((sql) => db.prepare(sql)));
      const newest = await db.prepare("SELECT version, checksum FROM marketplace_schema_migrations ORDER BY version DESC LIMIT 1")
        .first<{ version: number; checksum: string }>();
      if (newest && newest.version > MARKETPLACE_MIGRATION_VERSION) throw new Error(`DATABASE_SCHEMA_TOO_NEW:${newest.version}`);
      if (newest?.version === MARKETPLACE_MIGRATION_VERSION && newest.checksum !== MARKETPLACE_MIGRATION_CHECKSUM) {
        throw new Error("DATABASE_MIGRATION_CHECKSUM_MISMATCH");
      }
      if (!newest || newest.version < MARKETPLACE_MIGRATION_VERSION) {
        const legacyTables = await Promise.all([
          "marketplace_requests",
          "marketplace_quotes",
          "marketplace_drafts",
        ].map((name) => db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").bind(name).first<{ found: number }>()));
        if (legacyTables.every(Boolean)) {
          await db.batch(marketplaceLegacyImportStatements.map((sql) => db.prepare(sql)));
        }
        await db.batch(marketplaceDataRepairStatements.map((sql) => db.prepare(sql)));
        if (newest && newest.version < 4) {
          await db.batch(marketplaceRegionExpansionStatements.map((sql) => db.prepare(sql)));
        }
        if (newest && newest.version < 5) {
          await db.batch(marketplaceVisibilityExpansionStatements.map((sql) => db.prepare(sql)));
        }
        await db.prepare(`INSERT OR IGNORE INTO marketplace_schema_migrations (
          version, checksum, applied_at
        ) VALUES (?, ?, ?)`).bind(
          MARKETPLACE_MIGRATION_VERSION,
          MARKETPLACE_MIGRATION_CHECKSUM,
          new Date().toISOString(),
        ).run();
      }
      if(!options.readinessOnly)await pruneExpiredMarketplaceData(true);
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
    return schemaPromise;
  };

  const existingRequest = (context: MarketplaceMutationContext) => db.prepare(
    "SELECT * FROM marketplace_requests_v2 WHERE owner_actor_id = ? AND idempotency_key = ?",
  ).bind(context.actorId, context.idempotencyKey).first<RequestRow>();
  const existingQuote = (context: MarketplaceMutationContext) => db.prepare(
    "SELECT * FROM marketplace_quotes_v2 WHERE supplier_actor_id = ? AND idempotency_key = ?",
  ).bind(context.actorId, context.idempotencyKey).first<QuoteRow>();
  const existingDraft = (context: MarketplaceMutationContext) => db.prepare(
    "SELECT * FROM marketplace_drafts_v2 WHERE owner_actor_id = ? AND idempotency_key = ?",
  ).bind(context.actorId, context.idempotencyKey).first<DraftRow>();

  return {
    async establishSession(actor: MarketplaceActor) {
      await ensureSchema();
      await pruneExpiredMarketplaceData();
      const now = new Date().toISOString();
      const result = await db.prepare(`INSERT INTO marketplace_sessions_v2 (
        actor_id, session_hash, source, created_at, last_seen_at, expires_at
      ) SELECT ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM marketplace_sessions_v2 WHERE actor_id = ?)
        OR (SELECT COUNT(*) FROM marketplace_sessions_v2) < ?
      ON CONFLICT(actor_id) DO UPDATE SET
        session_hash = excluded.session_hash,
        source = excluded.source,
        last_seen_at = excluded.last_seen_at,
        expires_at = excluded.expires_at`).bind(
        actor.id,
        actor.sessionHash,
        actor.source,
        now,
        now,
        actor.expiresAt,
        actor.id,
        capacityLimits.sessions,
      ).run();
      if (d1Changes(result, "session_upsert") !== 1) throw new MarketplaceCapacityError("sessions");
    },
    async touchSession(actor: MarketplaceActor) {
      await ensureSchema();
      const now = new Date().toISOString();
      const result = await db.prepare(`UPDATE marketplace_sessions_v2 SET last_seen_at = ?, expires_at = ?
        WHERE actor_id = ? AND session_hash = ? AND expires_at > ?`).bind(
        now,
        actor.expiresAt,
        actor.id,
        actor.sessionHash,
        now,
      ).run();
      return (result.meta?.changes ?? 0) === 1;
    },
    async consumeWriteAllowance(actorId, routeScope) {
      await ensureSchema();
      await pruneExpiredMarketplaceData();
      const now = Date.now();
      await db.prepare(`INSERT INTO marketplace_write_limits_v2 (
        actor_id, route_scope, window_started_at, write_count, updated_at
      ) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(actor_id, route_scope) DO UPDATE SET
        window_started_at = CASE
          WHEN marketplace_write_limits_v2.window_started_at + ? <= excluded.window_started_at
          THEN excluded.window_started_at ELSE marketplace_write_limits_v2.window_started_at END,
        write_count = CASE
          WHEN marketplace_write_limits_v2.window_started_at + ? <= excluded.window_started_at
          THEN 1 ELSE marketplace_write_limits_v2.write_count + 1 END,
        updated_at = excluded.updated_at`).bind(
        actorId,
        routeScope,
        now,
        new Date(now).toISOString(),
        RATE_WINDOW_MS,
        RATE_WINDOW_MS,
      ).run();
      const row = await db.prepare(`SELECT window_started_at, write_count
        FROM marketplace_write_limits_v2 WHERE actor_id = ? AND route_scope = ?`).bind(actorId, routeScope)
        .first<{ window_started_at: number; write_count: number }>();
      if (row && row.write_count > MAX_WRITES_PER_WINDOW) {
        throw new MarketplaceRateLimitError(Math.max(1, Math.ceil((row.window_started_at + RATE_WINDOW_MS - now) / 1_000)));
      }
    },
    async listOwnedRequests(actorId, options) {
      await ensureSchema();
      await pruneExpiredMarketplaceData();
      const values: unknown[] = [actorId];
      const audience = `requests:mine:${actorId}`;
      const cursor = await cursorFragment(options, values, audience);
      values.push(options.limit + 1);
      const result = await db.prepare(`SELECT * FROM marketplace_requests_v2
        WHERE owner_actor_id = ? AND visibility = 'market'${cursor}
        ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...values).all<RequestRow>();
      return marketplacePage((result.results ?? []).map(mapRequest), options.limit, audience);
    },
    async listPublicRequests(options) {
      await ensureSchema();
      await pruneExpiredMarketplaceData();
      const values: unknown[] = [];
      const audience = "requests:market";
      const cursor = await cursorFragment(options, values, audience);
      values.push(options.limit + 1);
      const result = await db.prepare(`SELECT * FROM marketplace_requests_v2
        WHERE visibility = 'market'${cursor}
        ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...values).all<RequestRow>();
      return marketplacePage((result.results ?? []).map(mapRequest).map(publicRequestRecord), options.limit, audience);
    },
    async createRequest(context, input: CreateMarketplaceRequest, options = {}) {
      await ensureSchema();
      const replay = replayOrConflict(await existingRequest(context), context.payloadHash, mapRequest);
      if (replay) return replay;
      const record = requestRecord(input);
      try {
        const results = await db.batch([
          db.prepare(`INSERT INTO marketplace_requests_v2 (
            id, owner_actor_id, idempotency_key, payload_hash, visibility,
            request_type, kind, title, category, region, pricing_unit, quantity,
            duration_hours, delivery_date, summary, offered_json, wanted_json,
            cash_direction, cash_amount, status, created_at, updated_at, version
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1
          WHERE (SELECT COUNT(*) FROM marketplace_requests_v2 WHERE owner_actor_id <> ?) < ?`).bind(
            record.id,
            context.actorId,
            context.idempotencyKey,
            context.payloadHash,
            options.visibility ?? "market",
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
            CURATED_DEMAND_OWNER,
            capacityLimits.requests,
          ),
          eventStatement(db, context.actorId, "request", record.id, "REQUEST_CREATED", options.visibility === "private" ? "需求已私有暂存，等待关联记录完成。" : "需求已记录并生成匿名市场投影。", record.createdAt, { kind: "request", id: record.id }),
        ]);
        if (d1Changes(results[0], "request_insert") !== 1) throw new MarketplaceCapacityError("requests");
        return { record, replayed: false };
      } catch (error) {
        const raced = replayOrConflict(await existingRequest(context), context.payloadHash, mapRequest);
        if (raced) return raced;
        throw error;
      }
    },
    async publishRequest(actorId,requestId){
      await ensureSchema();const current=await db.prepare("SELECT * FROM marketplace_requests_v2 WHERE id=? AND owner_actor_id=?").bind(requestId,actorId).first<RequestRow>();if(!current)throw new MarketplaceAccessError("DEMAND_NOT_FOUND");
      if(current.visibility==="private"){const at=new Date().toISOString();await db.batch([db.prepare("UPDATE marketplace_requests_v2 SET visibility='market',updated_at=?,version=version+1 WHERE id=? AND owner_actor_id=? AND visibility='private'").bind(at,requestId,actorId),eventStatement(db,actorId,"request",requestId,"REQUEST_PUBLISHED","需求关联记录完整，已生成匿名市场投影。",at,{kind:"request",id:requestId})]);}
      const row=await db.prepare("SELECT * FROM marketplace_requests_v2 WHERE id=? AND owner_actor_id=? AND visibility='market'").bind(requestId,actorId).first<RequestRow>();if(!row)throw new MarketplaceAccessError("DEMAND_NOT_FOUND");return mapRequest(row);
    },
    async listBuyerNormalizedQuotes(actorId, options) {
      await ensureSchema();
      await pruneExpiredMarketplaceData();
      const values: unknown[] = [actorId];
      const audience = `quotes:buyer:${actorId}`;
      const cursor = await cursorFragment(options, values, audience);
      values.push(options.limit + 1);
      const result = await db.prepare(`SELECT * FROM marketplace_quotes_v2
        WHERE request_owner_actor_id = ?${cursor}
        ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...values).all<QuoteRow>();
      return marketplacePage((result.results ?? []).map(mapNormalizedQuote), options.limit, audience);
    },
    async listSupplierQuotes(actorId, options) {
      await ensureSchema();
      await pruneExpiredMarketplaceData();
      const values: unknown[] = [actorId];
      const audience = `quotes:supplier:${actorId}`;
      const cursor = await cursorFragment(options, values, audience);
      values.push(options.limit + 1);
      const result = await db.prepare(`SELECT * FROM marketplace_quotes_v2
        WHERE supplier_actor_id = ?${cursor}
        ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...values).all<QuoteRow>();
      return marketplacePage((result.results ?? []).map(mapSupplierQuote), options.limit, audience);
    },
    async createQuote(context, input: CreateMarketplaceQuote) {
      await ensureSchema();
      const replay = replayOrConflict(await existingQuote(context), context.payloadHash, mapSupplierQuote);
      if (replay) return replay;
      const demand = await db.prepare("SELECT * FROM marketplace_requests_v2 WHERE id = ? AND visibility = 'market'")
        .bind(input.demandId).first<RequestRow>();
      if (!demand) throw new MarketplaceAccessError("DEMAND_NOT_AVAILABLE");
      const records = quoteWriteRecord(input, mapRequest(demand));
      try {
        const results = await db.batch([
          db.prepare(`INSERT INTO marketplace_quotes_v2 (
            id, supplier_actor_id, request_owner_actor_id, idempotency_key, payload_hash,
            demand_id, demand_title, raw_unit_price, standardized_unit_price,
            pricing_unit, currency, lead_time, valid_days, valid_until,
            raw_scope_note, standardized_scope_note, standardization_version,
            standardization_note, supplier_status, normalized_status, created_at
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM marketplace_requests_v2
            WHERE id = ? AND visibility = 'market' AND version = ?
          )
            AND (SELECT COUNT(*) FROM marketplace_quotes_v2
              WHERE demand_id = ? AND valid_until > ? AND standardization_version NOT LIKE '%@superseded:%') < ?
            AND (SELECT COUNT(*) FROM marketplace_quotes_v2) < ?`).bind(
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
            demand.id,
            demand.version,
            demand.id,
            records.supplier.createdAt,
            capacityLimits.quotesPerDemand,
            capacityLimits.quotes,
          ),
          db.prepare(`UPDATE marketplace_requests_v2
            SET status = '方案待确认',
                updated_at = CASE WHEN updated_at > ? THEN updated_at ELSE ? END,
                version = version + 1
            WHERE id = ? AND version = ?
              AND EXISTS (SELECT 1 FROM marketplace_quotes_v2 WHERE id = ?)`).bind(
                records.supplier.createdAt,
                records.supplier.createdAt,
                demand.id,
                demand.version,
                records.supplier.id,
              ),
          eventStatement(db, context.actorId, "request", demand.id, "QUOTE_SUBMITTED", "供应方已提交一条原始报价。", records.supplier.createdAt, { kind: "quote", id: records.supplier.id }),
          eventStatement(db, "system:kai", "request", demand.id, "QUOTE_STANDARDIZED", "KAI 已生成需求方可见的标准化方案。", records.supplier.createdAt, { kind: "quote", id: records.supplier.id }),
        ]);
        const inserted = d1Changes(results[0], "quote_insert");
        const updated = d1Changes(results[1], "demand_version_update");
        if (inserted === 1) {
          if (updated !== 1) throw new MarketplaceStateConflictError();
          return { record: records.supplier, replayed: false };
        }
        if (inserted !== 0 || updated !== 0) throw new Error("D1_QUOTE_BATCH_INCONSISTENT");

        const currentDemand = await db.prepare("SELECT * FROM marketplace_requests_v2 WHERE id = ? AND visibility = 'market'")
          .bind(input.demandId).first<RequestRow>();
        if (!currentDemand) throw new MarketplaceAccessError("DEMAND_NOT_AVAILABLE");
        if (currentDemand.version !== demand.version) throw new MarketplaceStateConflictError();
        const demandQuoteCount = await db.prepare(`SELECT COUNT(*) AS count FROM marketplace_quotes_v2
          WHERE demand_id = ? AND valid_until > ? AND standardization_version NOT LIKE '%@superseded:%'`)
          .bind(demand.id, records.supplier.createdAt).first<{ count: number }>();
        if ((demandQuoteCount?.count ?? capacityLimits.quotesPerDemand) >= capacityLimits.quotesPerDemand) {
          throw new MarketplaceDemandQuoteLimitError();
        }
        const quoteCount = await db.prepare("SELECT COUNT(*) AS count FROM marketplace_quotes_v2")
          .first<{ count: number }>();
        if ((quoteCount?.count ?? capacityLimits.quotes) >= capacityLimits.quotes) {
          throw new MarketplaceCapacityError("quotes");
        }
        throw new Error("D1_CONDITIONAL_QUOTE_INSERT_FAILED");
      } catch (error) {
        const raced = replayOrConflict(await existingQuote(context), context.payloadHash, mapSupplierQuote);
        if (raced) return raced;
        throw error;
      }
    },
    async listOwnedDrafts(actorId, options) {
      await ensureSchema();
      await pruneExpiredMarketplaceData();
      const values: unknown[] = [actorId];
      const audience = `drafts:mine:${actorId}`;
      const cursor = await cursorFragment(options, values, audience);
      values.push(options.limit + 1);
      const result = await db.prepare(`SELECT * FROM marketplace_drafts_v2
        WHERE owner_actor_id = ?${cursor}
        ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...values).all<DraftRow>();
      return marketplacePage((result.results ?? []).map(mapDraft), options.limit, audience);
    },
    async createDraft(context, input: CreateMarketplaceDraft) {
      await ensureSchema();
      const replay = replayOrConflict(await existingDraft(context), context.payloadHash, mapDraft);
      if (replay) return replay;
      const record = draftRecord(input);
      try {
        const results = await db.batch([
          db.prepare(`INSERT INTO marketplace_drafts_v2 (
            id, owner_actor_id, idempotency_key, payload_hash,
            title, category, capacity, status, created_at
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE (SELECT COUNT(*) FROM marketplace_drafts_v2) < ?`).bind(
            record.id,
            context.actorId,
            context.idempotencyKey,
            context.payloadHash,
            record.title,
            record.category,
            record.capacity,
            record.status,
            record.createdAt,
            capacityLimits.drafts,
          ),
          eventStatement(db, context.actorId, "draft", record.id, "DRAFT_SAVED", "供应方资源草稿已保存。", record.createdAt, { kind: "draft", id: record.id }),
        ]);
        if (d1Changes(results[0], "draft_insert") !== 1) throw new MarketplaceCapacityError("drafts");
        return { record, replayed: false };
      } catch (error) {
        const raced = replayOrConflict(await existingDraft(context), context.payloadHash, mapDraft);
        if (raced) return raced;
        throw error;
      }
    },
    async health() {
      await ensureSchema();
      if(!options.readinessOnly)await pruneExpiredMarketplaceData();
      const [migration, requests, quotes, drafts, events] = await Promise.all([
        db.prepare("SELECT version, checksum FROM marketplace_schema_migrations ORDER BY version DESC LIMIT 1")
          .first<{ version: number; checksum: string }>(),
        db.prepare("SELECT COUNT(*) AS count FROM marketplace_requests_v2").first<{ count: number }>(),
        db.prepare("SELECT COUNT(*) AS count FROM marketplace_quotes_v2").first<{ count: number }>(),
        db.prepare("SELECT COUNT(*) AS count FROM marketplace_drafts_v2").first<{ count: number }>(),
        db.prepare("SELECT COUNT(*) AS count FROM marketplace_events_v2").first<{ count: number }>(),
      ]);
      if (migration?.version !== MARKETPLACE_MIGRATION_VERSION || migration.checksum !== MARKETPLACE_MIGRATION_CHECKSUM) {
        throw new Error("DATABASE_MIGRATION_NOT_READY");
      }
      return {
        backend: "d1",
        schemaVersion: migration.version,
        integrity: "ok",
        requests: requests?.count ?? 0,
        quotes: quotes?.count ?? 0,
        drafts: drafts?.count ?? 0,
        events: events?.count ?? 0,
      };
    },
  };
}
