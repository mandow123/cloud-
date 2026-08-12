CREATE TABLE IF NOT EXISTS hosting_v2_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hosting_v2_instances (
  contract_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  provision_command_id TEXT NOT NULL UNIQUE,
  approved_image TEXT NOT NULL,
  endpoint_display TEXT NOT NULL,
  container_digest TEXT NOT NULL,
  workspace_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('READY','RUNNING','STOPPED','CLEANED','FAILED')),
  provision_evidence_digest TEXT NOT NULL,
  start_evidence_digest TEXT,
  stop_evidence_digest TEXT,
  provisioned_at TEXT NOT NULL,
  started_at TEXT,
  stopped_at TEXT,
  cleaned_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hosting_v2_instances_device_idx ON hosting_v2_instances(device_id, status, updated_at DESC);
CREATE TRIGGER IF NOT EXISTS hosting_v2_instance_identity_immutable BEFORE UPDATE ON hosting_v2_instances
  WHEN OLD.contract_id<>NEW.contract_id OR OLD.device_id<>NEW.device_id OR OLD.provision_command_id<>NEW.provision_command_id
    OR OLD.approved_image<>NEW.approved_image OR OLD.endpoint_display<>NEW.endpoint_display
    OR OLD.container_digest<>NEW.container_digest OR OLD.workspace_digest<>NEW.workspace_digest
    OR OLD.provision_evidence_digest<>NEW.provision_evidence_digest OR OLD.provisioned_at<>NEW.provisioned_at
  BEGIN SELECT RAISE(ABORT, 'hosting instance identity immutable'); END;

CREATE TABLE IF NOT EXISTS hosting_v2_metering_proofs (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL UNIQUE,
  container_digest TEXT NOT NULL,
  runtime_state_digest TEXT NOT NULL,
  agent_started_at TEXT NOT NULL,
  agent_stopped_at TEXT NOT NULL,
  agent_runtime_seconds INTEGER NOT NULL CHECK (agent_runtime_seconds >= 0),
  server_measured_seconds INTEGER NOT NULL CHECK (server_measured_seconds >= 180),
  evidence_digest TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS hosting_v2_metering_proofs_immutable_update BEFORE UPDATE ON hosting_v2_metering_proofs BEGIN SELECT RAISE(ABORT, 'hosting metering proof immutable'); END;
CREATE TRIGGER IF NOT EXISTS hosting_v2_metering_proofs_immutable_delete BEFORE DELETE ON hosting_v2_metering_proofs BEGIN SELECT RAISE(ABORT, 'hosting metering proof immutable'); END;

CREATE TABLE IF NOT EXISTS hosting_v2_cleanup_proofs (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL UNIQUE,
  container_digest TEXT NOT NULL,
  cleanup_digest TEXT NOT NULL,
  container_removed INTEGER NOT NULL CHECK (container_removed = 1),
  authorized_key_removed INTEGER NOT NULL CHECK (authorized_key_removed = 1),
  workspace_removed INTEGER NOT NULL CHECK (workspace_removed = 1),
  evidence_digest TEXT NOT NULL,
  cleaned_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS hosting_v2_cleanup_proofs_immutable_update BEFORE UPDATE ON hosting_v2_cleanup_proofs BEGIN SELECT RAISE(ABORT, 'hosting cleanup proof immutable'); END;
CREATE TRIGGER IF NOT EXISTS hosting_v2_cleanup_proofs_immutable_delete BEFORE DELETE ON hosting_v2_cleanup_proofs BEGIN SELECT RAISE(ABORT, 'hosting cleanup proof immutable'); END;

INSERT OR IGNORE INTO hosting_v2_schema_migrations(version,applied_at) VALUES(3,datetime('now'));
