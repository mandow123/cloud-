CREATE TABLE IF NOT EXISTS supply_offers (
  id TEXT PRIMARY KEY,
  supplier_actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  supplier_type TEXT NOT NULL CHECK (supplier_type IN ('INDIVIDUAL','COMPANY','IDC','CLOUD_VENDOR')),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('GPU_CARD','GPU_SERVER','CPU_SERVER','MAC_COMPUTE','TOKEN_CAPACITY','MODEL_INSTANCE','NAS_STORAGE','RACK_CAPACITY','CLOUD_RESOURCE')),
  quantity INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 100000),
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('CARD','NODE','SERVER','M_TOKENS_PER_HOUR','MODEL_INSTANCE','TIB','RACK','KW','QUOTA_UNIT')),
  pricing_unit TEXT NOT NULL CHECK (pricing_unit IN ('CARD_HOUR','NODE_HOUR','SERVER_HOUR','TOKEN_CAPACITY_HOUR','MODEL_INSTANCE_HOUR','TIB_HOUR','RACK_MONTH','KW_MONTH','QUOTA_HOUR')),
  product_name TEXT NOT NULL,
  specification TEXT NOT NULL,
  region TEXT NOT NULL,
  delivery_form TEXT NOT NULL,
  availability_start_at TEXT,
  availability_end_at TEXT,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','UNDER_VERIFICATION','VERIFIED','REJECTED','PUBLISHED')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (supplier_actor_id, idempotency_key),
  CHECK ((availability_start_at IS NULL AND availability_end_at IS NULL) OR
    (availability_start_at IS NOT NULL AND availability_end_at IS NOT NULL AND availability_end_at > availability_start_at)),
  CHECK (
    (resource_type='GPU_CARD' AND quantity_unit='CARD' AND pricing_unit='CARD_HOUR') OR
    (resource_type='GPU_SERVER' AND quantity_unit='NODE' AND pricing_unit='NODE_HOUR') OR
    (resource_type='CPU_SERVER' AND quantity_unit='SERVER' AND pricing_unit='SERVER_HOUR') OR
    (resource_type='MAC_COMPUTE' AND quantity_unit='NODE' AND pricing_unit='NODE_HOUR') OR
    (resource_type='TOKEN_CAPACITY' AND quantity_unit='M_TOKENS_PER_HOUR' AND pricing_unit='TOKEN_CAPACITY_HOUR') OR
    (resource_type='MODEL_INSTANCE' AND quantity_unit='MODEL_INSTANCE' AND pricing_unit='MODEL_INSTANCE_HOUR') OR
    (resource_type='NAS_STORAGE' AND quantity_unit='TIB' AND pricing_unit='TIB_HOUR') OR
    (resource_type='RACK_CAPACITY' AND ((quantity_unit='RACK' AND pricing_unit='RACK_MONTH') OR (quantity_unit='KW' AND pricing_unit='KW_MONTH'))) OR
    (resource_type='CLOUD_RESOURCE' AND quantity_unit='QUOTA_UNIT' AND pricing_unit='QUOTA_HOUR')
  )
);

CREATE INDEX IF NOT EXISTS supply_offers_supplier_idx ON supply_offers(supplier_actor_id, created_at DESC);

INSERT OR IGNORE INTO supply_schema_migrations (version, applied_at) VALUES (2, CURRENT_TIMESTAMP);
