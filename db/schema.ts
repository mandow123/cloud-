/**
 * Runtime-safe D1/SQLite schema. Each array item is exactly one SQL statement,
 * as required by D1 prepared statements.
 */
export const MARKETPLACE_MIGRATION_VERSION = 2;
export const MARKETPLACE_MIGRATION_CHECKSUM = "d74de64ac6ae258827f09dec9e5f2edf2e4c45b9a9d90749e8e72856d90889b5";

export const marketplaceSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS marketplace_schema_migrations (
    version INTEGER PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS marketplace_requests_v2 (
    id TEXT PRIMARY KEY,
    owner_actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    visibility TEXT NOT NULL CHECK (visibility = 'market'),
    request_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    region TEXT NOT NULL,
    pricing_unit TEXT NOT NULL,
    quantity REAL NOT NULL,
    duration_hours REAL,
    delivery_date TEXT,
    summary TEXT NOT NULL,
    offered_json TEXT,
    wanted_json TEXT,
    cash_direction TEXT NOT NULL,
    cash_amount REAL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    UNIQUE (owner_actor_id, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS marketplace_requests_v2_owner_created_idx
    ON marketplace_requests_v2(owner_actor_id, created_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS marketplace_requests_v2_market_created_idx
    ON marketplace_requests_v2(visibility, created_at DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS marketplace_quotes_v2 (
    id TEXT PRIMARY KEY,
    supplier_actor_id TEXT NOT NULL,
    request_owner_actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    demand_id TEXT NOT NULL,
    demand_title TEXT NOT NULL,
    raw_unit_price REAL NOT NULL,
    standardized_unit_price REAL NOT NULL,
    pricing_unit TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency = 'CNY'),
    lead_time TEXT NOT NULL,
    valid_days INTEGER NOT NULL,
    valid_until TEXT NOT NULL,
    raw_scope_note TEXT NOT NULL,
    standardized_scope_note TEXT NOT NULL,
    standardization_version TEXT NOT NULL,
    standardization_note TEXT NOT NULL,
    supplier_status TEXT NOT NULL,
    normalized_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (supplier_actor_id, idempotency_key),
    FOREIGN KEY (demand_id) REFERENCES marketplace_requests_v2(id)
  )`,
  `CREATE INDEX IF NOT EXISTS marketplace_quotes_v2_buyer_created_idx
    ON marketplace_quotes_v2(request_owner_actor_id, created_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS marketplace_quotes_v2_supplier_created_idx
    ON marketplace_quotes_v2(supplier_actor_id, created_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS marketplace_quotes_v2_demand_idx
    ON marketplace_quotes_v2(demand_id, created_at DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS marketplace_drafts_v2 (
    id TEXT PRIMARY KEY,
    owner_actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    capacity TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (owner_actor_id, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS marketplace_drafts_v2_owner_created_idx
    ON marketplace_drafts_v2(owner_actor_id, created_at DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS marketplace_events_v2 (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS marketplace_events_v2_entity_created_idx
    ON marketplace_events_v2(entity_type, entity_id, created_at ASC)`,
  `CREATE TABLE IF NOT EXISTS marketplace_write_limits_v2 (
    actor_id TEXT NOT NULL,
    route_scope TEXT NOT NULL,
    window_started_at INTEGER NOT NULL,
    write_count INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (actor_id, route_scope)
  )`,
  `CREATE TABLE IF NOT EXISTS marketplace_sessions_v2 (
    actor_id TEXT PRIMARY KEY,
    session_hash TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
] as const;

export const marketplaceLegacyImportStatements = [
  `INSERT OR IGNORE INTO marketplace_requests_v2 (
    id, owner_actor_id, idempotency_key, payload_hash, visibility,
    request_type, kind, title, category, region, pricing_unit, quantity,
    duration_hours, delivery_date, summary, offered_json, wanted_json,
    cash_direction, cash_amount, status, created_at, updated_at, version
  ) SELECT
    id, 'legacy-demo', 'legacy-' || id, 'legacy', 'market',
    request_type, kind, title, category, region, pricing_unit, quantity,
    duration_hours, delivery_date, summary, offered_json, wanted_json,
    cash_direction, cash_amount, status, created_at, updated_at, 1
  FROM marketplace_requests`,
  `INSERT OR IGNORE INTO marketplace_quotes_v2 (
    id, supplier_actor_id, request_owner_actor_id, idempotency_key, payload_hash,
    demand_id, demand_title, raw_unit_price, standardized_unit_price,
    pricing_unit, currency, lead_time, valid_days, valid_until,
    raw_scope_note, standardized_scope_note, standardization_version,
    standardization_note, supplier_status, normalized_status, created_at
  ) SELECT
    id, 'legacy-demo', 'legacy-demo', 'legacy-' || id, 'legacy',
    demand_id, demand_title, unit_price,
    CASE
      WHEN ROUND(unit_price * 1.03, 2) = unit_price THEN ROUND(unit_price + 0.01, 2)
      ELSE ROUND(unit_price * 1.03, 2)
    END,
    pricing_unit, 'CNY', lead_time, valid_days,
    datetime(created_at, '+' || valid_days || ' days'),
    scope_note, 'KAI 演示统一口径：人民币、需求计价单位、含税及基础服务保障；供应方自由文本不向需求方展示。', 'kai-demo-v2',
    '旧版演示报价已去除原始自由文本并应用 3% 占位系数；正式交易前需人工复核。', '已提交', '已标准化', created_at
  FROM marketplace_quotes
  WHERE demand_id IN (SELECT id FROM marketplace_requests_v2)`,
  `INSERT OR IGNORE INTO marketplace_drafts_v2 (
    id, owner_actor_id, idempotency_key, payload_hash,
    title, category, capacity, status, created_at
  ) SELECT
    id, 'legacy-demo', 'legacy-' || id, 'legacy',
    title, category, capacity, status, created_at
  FROM marketplace_drafts`,
] as const;
