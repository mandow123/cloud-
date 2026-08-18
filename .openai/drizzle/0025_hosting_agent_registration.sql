CREATE TABLE IF NOT EXISTS hosting_v2_agent_registrations (
  challenge_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  registered_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hosting_v2_agent_registrations_org_idx
  ON hosting_v2_agent_registrations(organization_id, registered_at DESC);
CREATE TRIGGER IF NOT EXISTS hosting_v2_agent_registration_immutable_update
  BEFORE UPDATE ON hosting_v2_agent_registrations
  BEGIN SELECT RAISE(ABORT, 'hosting agent registration immutable'); END;
CREATE TRIGGER IF NOT EXISTS hosting_v2_agent_registration_immutable_delete
  BEFORE DELETE ON hosting_v2_agent_registrations
  BEGIN SELECT RAISE(ABORT, 'hosting agent registration immutable'); END;
INSERT OR IGNORE INTO hosting_v2_schema_migrations(version,applied_at) VALUES(10,datetime('now'));
