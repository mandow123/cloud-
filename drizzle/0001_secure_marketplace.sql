CREATE TABLE IF NOT EXISTS marketplace_schema_migrations (
  version INTEGER PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS marketplace_requests_v2 (
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
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS marketplace_requests_v2_owner_created_idx ON marketplace_requests_v2(owner_actor_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS marketplace_requests_v2_market_created_idx ON marketplace_requests_v2(visibility, created_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS marketplace_quotes_v2 (
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
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS marketplace_quotes_v2_buyer_created_idx ON marketplace_quotes_v2(request_owner_actor_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS marketplace_quotes_v2_supplier_created_idx ON marketplace_quotes_v2(supplier_actor_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS marketplace_quotes_v2_demand_idx ON marketplace_quotes_v2(demand_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS marketplace_drafts_v2 (
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
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS marketplace_drafts_v2_owner_created_idx ON marketplace_drafts_v2(owner_actor_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS marketplace_events_v2 (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS marketplace_events_v2_entity_created_idx ON marketplace_events_v2(entity_type, entity_id, created_at ASC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS marketplace_write_limits_v2 (
  actor_id TEXT NOT NULL,
  route_scope TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  write_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (actor_id, route_scope)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS marketplace_sessions_v2 (
  actor_id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
