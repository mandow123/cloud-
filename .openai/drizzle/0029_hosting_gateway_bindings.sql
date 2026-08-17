CREATE TABLE IF NOT EXISTS hosting_v2_gateway_bindings (
  contract_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  lease_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode='ACCESS_GATEWAY'),
  status TEXT NOT NULL CHECK (status IN ('LEASE_CREATED','SLOT_CONFIRMED','REVOCATION_REQUIRED','REVOKED')),
  buyer_endpoint TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  slot_confirmed_at TEXT,
  revocation_required_at TEXT,
  revoked_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hosting_v2_gateway_bindings_device_status_idx
  ON hosting_v2_gateway_bindings(device_id,status,updated_at DESC);
CREATE TRIGGER IF NOT EXISTS hosting_v2_gateway_binding_identity_immutable
  BEFORE UPDATE ON hosting_v2_gateway_bindings
  WHEN OLD.contract_id<>NEW.contract_id OR OLD.device_id<>NEW.device_id OR OLD.lease_id<>NEW.lease_id OR OLD.mode<>NEW.mode
    OR OLD.buyer_endpoint<>NEW.buyer_endpoint OR OLD.expires_at<>NEW.expires_at OR OLD.created_at<>NEW.created_at
  BEGIN SELECT RAISE(ABORT, 'hosting gateway binding identity immutable'); END;
CREATE TRIGGER IF NOT EXISTS hosting_v2_gateway_binding_status_forward_only
  BEFORE UPDATE OF status ON hosting_v2_gateway_bindings
  WHEN NOT (
    OLD.status=NEW.status
    OR (OLD.status='LEASE_CREATED' AND NEW.status IN ('SLOT_CONFIRMED','REVOCATION_REQUIRED','REVOKED'))
    OR (OLD.status='SLOT_CONFIRMED' AND NEW.status IN ('REVOCATION_REQUIRED','REVOKED'))
    OR (OLD.status='REVOCATION_REQUIRED' AND NEW.status='REVOKED')
  )
  BEGIN SELECT RAISE(ABORT, 'hosting gateway binding status cannot regress'); END;
CREATE TRIGGER IF NOT EXISTS hosting_v2_gateway_binding_immutable_delete
  BEFORE DELETE ON hosting_v2_gateway_bindings
  BEGIN SELECT RAISE(ABORT, 'hosting gateway binding immutable'); END;

INSERT OR IGNORE INTO hosting_v2_schema_migrations(version,applied_at) VALUES(15,datetime('now'));
