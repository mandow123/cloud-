CREATE TABLE IF NOT EXISTS exchange_schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_product_versions (
  id TEXT PRIMARY KEY,
  product_code TEXT NOT NULL CHECK (product_code IN ('GPU_COMPUTE', 'TOKEN_USAGE', 'TOKEN_THROUGHPUT', 'MODEL_INSTANCE', 'NAS_STORAGE', 'RACK_SPACE', 'POWER_CAPACITY')),
  pricing_unit_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  form_factor TEXT NOT NULL,
  specs_json TEXT NOT NULL,
  immutable_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_resource_assets (
  id TEXT PRIMARY KEY,
  supplier_actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  product_version_id TEXT NOT NULL,
  title TEXT NOT NULL,
  region TEXT NOT NULL,
  delivery_form TEXT NOT NULL,
  total_parallel_units INTEGER NOT NULL CHECK (total_parallel_units > 0),
  interruptibility TEXT NOT NULL CHECK (interruptibility IN ('NON_INTERRUPTIBLE', 'INTERRUPTIBLE')),
  network_scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DECLARED', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'WITHDRAWN')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (supplier_actor_id, idempotency_key),
  FOREIGN KEY (product_version_id) REFERENCES exchange_product_versions(id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_resource_assets_supplier_idx ON exchange_resource_assets(supplier_actor_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_verification_runs (
  id TEXT PRIMARY KEY,
  resource_asset_id TEXT NOT NULL,
  operator_actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('MANUAL', 'CONNECTOR', 'CLOUD_API')),
  result TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL')),
  evidence_summary TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  valid_until TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (operator_actor_id, idempotency_key),
  FOREIGN KEY (resource_asset_id) REFERENCES exchange_resource_assets(id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_verification_runs_resource_idx ON exchange_verification_runs(resource_asset_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_capacity_lots (
  id TEXT PRIMARY KEY,
  supplier_actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  resource_asset_id TEXT NOT NULL,
  verification_run_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  parallel_units INTEGER NOT NULL CHECK (parallel_units > 0),
  capacity_gpu_seconds INTEGER NOT NULL CHECK (capacity_gpu_seconds > 0),
  interruptibility TEXT NOT NULL CHECK (interruptibility IN ('NON_INTERRUPTIBLE', 'INTERRUPTIBLE')),
  status TEXT NOT NULL CHECK (status IN ('READY', 'LISTED', 'SUSPENDED', 'EXPIRED', 'WITHDRAWN')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (supplier_actor_id, idempotency_key),
  FOREIGN KEY (resource_asset_id) REFERENCES exchange_resource_assets(id),
  FOREIGN KEY (verification_run_id) REFERENCES exchange_verification_runs(id),
  CHECK (end_at > start_at)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_capacity_lots_supplier_idx ON exchange_capacity_lots(supplier_actor_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_capacity_lots_window_idx ON exchange_capacity_lots(resource_asset_id, start_at, end_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_listing_versions (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  supplier_actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  capacity_lot_id TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  pricing_unit_code TEXT NOT NULL CHECK (pricing_unit_code = 'GPU_HOUR'),
  min_parallel_units INTEGER NOT NULL CHECK (min_parallel_units > 0),
  max_parallel_units INTEGER NOT NULL CHECK (max_parallel_units >= min_parallel_units),
  min_duration_minutes INTEGER NOT NULL CHECK (min_duration_minutes > 0),
  tax_included INTEGER NOT NULL CHECK (tax_included IN (0, 1)),
  energy_included INTEGER NOT NULL CHECK (energy_included IN (0, 1)),
  network_included INTEGER NOT NULL CHECK (network_included IN (0, 1)),
  scope_note TEXT NOT NULL,
  sla_json TEXT NOT NULL,
  delivery_form TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'WITHDRAWN', 'EXPIRED')),
  created_at TEXT NOT NULL,
  UNIQUE (listing_id, version_number),
  UNIQUE (supplier_actor_id, idempotency_key),
  FOREIGN KEY (capacity_lot_id) REFERENCES exchange_capacity_lots(id),
  CHECK (valid_until > valid_from)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_listing_versions_market_idx ON exchange_listing_versions(status, valid_until, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_domain_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_domain_events_entity_idx ON exchange_domain_events(entity_type, entity_id, occurred_at ASC);
--> statement-breakpoint
INSERT OR IGNORE INTO exchange_product_versions (
  id, product_code, pricing_unit_code, display_name, manufacturer, model,
  form_factor, specs_json, immutable_hash, created_at
) VALUES
  ('PV-GPU-H100-SXM5-80GB', 'GPU_COMPUTE', 'GPU_HOUR', 'NVIDIA H100 SXM5 80GB', 'NVIDIA', 'H100 80GB', 'SXM5', '{"memoryGiB":80,"architecture":"Hopper"}', 'gpu:nvidia:h100-80gb:sxm5:v1', '2026-08-05T00:00:00.000Z'),
  ('PV-GPU-H100-PCIE-80GB', 'GPU_COMPUTE', 'GPU_HOUR', 'NVIDIA H100 PCIe 80GB', 'NVIDIA', 'H100 80GB', 'PCIe', '{"memoryGiB":80,"architecture":"Hopper"}', 'gpu:nvidia:h100-80gb:pcie:v1', '2026-08-05T00:00:00.000Z'),
  ('PV-GPU-A100-SXM4-80GB', 'GPU_COMPUTE', 'GPU_HOUR', 'NVIDIA A100 SXM4 80GB', 'NVIDIA', 'A100 80GB', 'SXM4', '{"memoryGiB":80,"architecture":"Ampere"}', 'gpu:nvidia:a100-80gb:sxm4:v1', '2026-08-05T00:00:00.000Z'),
  ('PV-GPU-H20-PCIE-96GB', 'GPU_COMPUTE', 'GPU_HOUR', 'NVIDIA H20 PCIe 96GB', 'NVIDIA', 'H20 96GB', 'PCIe', '{"memoryGiB":96,"architecture":"Hopper"}', 'gpu:nvidia:h20-96gb:pcie:v1', '2026-08-05T00:00:00.000Z');
--> statement-breakpoint
INSERT OR IGNORE INTO exchange_schema_migrations (version, applied_at) VALUES (1, '2026-08-05T00:00:00.000Z');
