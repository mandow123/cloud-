/**
 * Runtime-safe D1/SQLite schema. Each array item is exactly one SQL statement,
 * as required by D1 prepared statements.
 */
export const MARKETPLACE_MIGRATION_VERSION = 4;
export const MARKETPLACE_MIGRATION_CHECKSUM = "758924113b3f07d65f1db51bc7007e30d503a40dac720475dce19df6403bc2a6";

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
    region TEXT NOT NULL CHECK (region IN ('北京', '上海', '广东', '浙江', '四川', '内蒙古', '全国')),
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
    lead_time TEXT NOT NULL CHECK (lead_time IN ('48 小时内', '7 天内', '30 天内', '排期交付')),
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

/**
 * Version 4 preserves every marketplace request and quote while widening the
 * request service-area enum. The child quote table is rebuilt in the same
 * transaction so foreign keys never point at a renamed or deleted parent.
 */
export const marketplaceRegionExpansionStatements = [
  `CREATE TABLE marketplace_requests_v2_region_v4 (
    id TEXT PRIMARY KEY,
    owner_actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    visibility TEXT NOT NULL CHECK (visibility = 'market'),
    request_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    region TEXT NOT NULL CHECK (region IN ('北京', '上海', '广东', '浙江', '四川', '内蒙古', '全国')),
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
  `INSERT INTO marketplace_requests_v2_region_v4 (
    id, owner_actor_id, idempotency_key, payload_hash, visibility,
    request_type, kind, title, category, region, pricing_unit, quantity,
    duration_hours, delivery_date, summary, offered_json, wanted_json,
    cash_direction, cash_amount, status, created_at, updated_at, version
  ) SELECT
    id, owner_actor_id, idempotency_key, payload_hash, visibility,
    request_type, kind, title, category, region, pricing_unit, quantity,
    duration_hours, delivery_date, summary, offered_json, wanted_json,
    cash_direction, cash_amount, status, created_at, updated_at, version
  FROM marketplace_requests_v2`,
  `CREATE TABLE marketplace_quotes_v2_region_v4 (
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
    lead_time TEXT NOT NULL CHECK (lead_time IN ('48 小时内', '7 天内', '30 天内', '排期交付')),
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
    FOREIGN KEY (demand_id) REFERENCES marketplace_requests_v2_region_v4(id)
  )`,
  `INSERT INTO marketplace_quotes_v2_region_v4 (
    id, supplier_actor_id, request_owner_actor_id, idempotency_key,
    payload_hash, demand_id, demand_title, raw_unit_price,
    standardized_unit_price, pricing_unit, currency, lead_time, valid_days,
    valid_until, raw_scope_note, standardized_scope_note,
    standardization_version, standardization_note, supplier_status,
    normalized_status, created_at
  ) SELECT
    id, supplier_actor_id, request_owner_actor_id, idempotency_key,
    payload_hash, demand_id, demand_title, raw_unit_price,
    standardized_unit_price, pricing_unit, currency, lead_time, valid_days,
    valid_until, raw_scope_note, standardized_scope_note,
    standardization_version, standardization_note, supplier_status,
    normalized_status, created_at
  FROM marketplace_quotes_v2`,
  `DROP TABLE marketplace_quotes_v2`,
  `DROP TABLE marketplace_requests_v2`,
  `ALTER TABLE marketplace_requests_v2_region_v4 RENAME TO marketplace_requests_v2`,
  `ALTER TABLE marketplace_quotes_v2_region_v4 RENAME TO marketplace_quotes_v2`,
  `CREATE INDEX marketplace_requests_v2_owner_created_idx
    ON marketplace_requests_v2(owner_actor_id, created_at DESC, id DESC)`,
  `CREATE INDEX marketplace_requests_v2_market_created_idx
    ON marketplace_requests_v2(visibility, created_at DESC, id DESC)`,
  `CREATE INDEX marketplace_quotes_v2_buyer_created_idx
    ON marketplace_quotes_v2(request_owner_actor_id, created_at DESC, id DESC)`,
  `CREATE INDEX marketplace_quotes_v2_supplier_created_idx
    ON marketplace_quotes_v2(supplier_actor_id, created_at DESC, id DESC)`,
  `CREATE INDEX marketplace_quotes_v2_demand_idx
    ON marketplace_quotes_v2(demand_id, created_at DESC, id DESC)`,
] as const;

export const marketplaceLegacyImportStatements = [
  `INSERT OR IGNORE INTO marketplace_requests_v2 (
    id, owner_actor_id, idempotency_key, payload_hash, visibility,
    request_type, kind, title, category, region, pricing_unit, quantity,
    duration_hours, delivery_date, summary, offered_json, wanted_json,
    cash_direction, cash_amount, status, created_at, updated_at, version
  ) SELECT
    id, 'legacy-import', 'legacy-' || id, 'legacy', 'market',
    request_type, kind, title, category,
    CASE region
      WHEN '华北' THEN '北京'
      WHEN '华东' THEN '上海'
      WHEN '华南' THEN '广东'
      WHEN '西南' THEN '四川'
      ELSE region
    END,
    pricing_unit, quantity,
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
    id, 'legacy-import', 'legacy-import', 'legacy-' || id, 'legacy',
    demand_id, demand_title, unit_price,
    CASE
      WHEN ROUND(unit_price * 1.03, 2) = unit_price THEN ROUND(unit_price + 0.01, 2)
      ELSE ROUND(unit_price * 1.03, 2)
    END,
    pricing_unit, 'CNY',
    CASE lead_time
      WHEN '48 小时' THEN '48 小时内'
      WHEN '7 天' THEN '7 天内'
      WHEN '30 天' THEN '30 天内'
      ELSE lead_time
    END,
    valid_days,
    datetime(created_at, '+' || valid_days || ' days'),
    scope_note, 'KAI 统一口径：人民币、需求计价单位、含税及基础服务保障；供应方自由文本不向需求方展示。', 'kai-standard-v1',
    '历史报价已去除原始自由文本并应用标准化系数；交易前需人工复核。', '已提交', '已标准化', created_at
  FROM marketplace_quotes
  WHERE demand_id IN (SELECT id FROM marketplace_requests_v2)`,
  `INSERT OR IGNORE INTO marketplace_drafts_v2 (
    id, owner_actor_id, idempotency_key, payload_hash,
    title, category, capacity, status, created_at
  ) SELECT
    id, 'legacy-import', 'legacy-' || id, 'legacy',
    title, category, capacity, status, created_at
  FROM marketplace_drafts`,
] as const;

/** Repairs values written by pre-v3 Node deployments before the public enum
 * boundary was enforced in SQLite. These statements are safe to re-run. */
export const marketplaceDataRepairStatements = [
  `UPDATE marketplace_requests_v2
    SET region = CASE region
      WHEN '华北' THEN '北京'
      WHEN '华东' THEN '上海'
      WHEN '华南' THEN '广东'
      WHEN '西南' THEN '四川'
      ELSE region
    END
    WHERE region IN ('华北', '华东', '华南', '西南')`,
  `UPDATE marketplace_quotes_v2
    SET lead_time = CASE lead_time
      WHEN '48 小时' THEN '48 小时内'
      WHEN '7 天' THEN '7 天内'
      WHEN '30 天' THEN '30 天内'
      ELSE lead_time
    END
    WHERE lead_time IN ('48 小时', '7 天', '30 天')`,
  `UPDATE marketplace_requests_v2 SET owner_actor_id = 'legacy-import'
    WHERE owner_actor_id = 'legacy-demo'`,
  `UPDATE marketplace_quotes_v2
    SET supplier_actor_id = CASE supplier_actor_id WHEN 'legacy-demo' THEN 'legacy-import' ELSE supplier_actor_id END,
        request_owner_actor_id = CASE request_owner_actor_id WHEN 'legacy-demo' THEN 'legacy-import' ELSE request_owner_actor_id END
    WHERE supplier_actor_id = 'legacy-demo' OR request_owner_actor_id = 'legacy-demo'`,
  `UPDATE marketplace_drafts_v2 SET owner_actor_id = 'legacy-import'
    WHERE owner_actor_id = 'legacy-demo'`,
  `UPDATE marketplace_quotes_v2
    SET standardized_scope_note = 'KAI 统一口径：人民币、需求计价单位、含税及基础服务保障；供应方自由文本不向需求方展示。',
        standardization_version = 'kai-standard-v1',
        standardization_note = '历史报价已去除原始自由文本并应用标准化系数；交易前需人工复核。'
    WHERE standardization_version = 'kai-demo-v2'
       OR standardized_scope_note LIKE '%演示%'
       OR standardization_note LIKE '%演示%'`,
] as const;
