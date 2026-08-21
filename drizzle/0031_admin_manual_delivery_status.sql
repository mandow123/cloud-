CREATE TABLE IF NOT EXISTS admin_manual_delivery_statuses (
  demand_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('PENDING_MANUAL_DELIVERY','SUPPLIER_ASSIGNED','DELIVERY_IN_PROGRESS','AWAITING_BUYER_ACCEPTANCE','COMPLETED','CANCELLED','ACCESS_REVOKED')),
  supplier_organization_id TEXT,
  internal_note TEXT,
  buyer_visible_note TEXT,
  connection_host TEXT,
  connection_port INTEGER CHECK (connection_port IS NULL OR (connection_port BETWEEN 1 AND 65535)),
  connection_username TEXT,
  connection_host_key_fingerprint TEXT,
  assigned_at TEXT,
  started_at TEXT,
  delivered_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  revoked_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (demand_id) REFERENCES admin_manual_delivery_intakes(demand_id)
);

CREATE INDEX IF NOT EXISTS admin_manual_delivery_statuses_supplier_idx
  ON admin_manual_delivery_statuses(supplier_organization_id,status,updated_at DESC);

INSERT OR IGNORE INTO admin_manual_delivery_statuses(demand_id,status,version,created_at,updated_at)
SELECT demand_id,'PENDING_MANUAL_DELIVERY',1,created_at,updated_at
FROM admin_manual_delivery_intakes;
