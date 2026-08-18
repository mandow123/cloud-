CREATE TABLE IF NOT EXISTS hosting_v2_verification_proofs (
  command_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  agent_evidence_digest TEXT NOT NULL,
  control_plane_reachability_digest TEXT NOT NULL,
  public_host TEXT NOT NULL,
  public_port INTEGER NOT NULL CHECK (public_port BETWEEN 1024 AND 65535),
  recorded_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS hosting_v2_verification_proofs_immutable_update BEFORE UPDATE ON hosting_v2_verification_proofs BEGIN SELECT RAISE(ABORT, 'hosting verification proof immutable'); END;
CREATE TRIGGER IF NOT EXISTS hosting_v2_verification_proofs_immutable_delete BEFORE DELETE ON hosting_v2_verification_proofs BEGIN SELECT RAISE(ABORT, 'hosting verification proof immutable'); END;

INSERT OR IGNORE INTO hosting_v2_schema_migrations(version,applied_at) VALUES(4,datetime('now'));
