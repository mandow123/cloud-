-- Rollback-safe telemetry-only binding. Older applications ignore these
-- columns and continue treating pre-existing agents as FULL_HOST.
ALTER TABLE hosting_v2_agent_challenges ADD COLUMN application_id TEXT;
ALTER TABLE hosting_v2_agent_challenges ADD COLUMN capability_mode TEXT NOT NULL DEFAULT 'FULL_HOST'
  CHECK (capability_mode IN ('FULL_HOST','TELEMETRY_ONLY'));
CREATE INDEX IF NOT EXISTS hosting_v2_challenge_application_idx
  ON hosting_v2_agent_challenges(application_id,capability_mode,expires_at);

ALTER TABLE hosting_v2_devices ADD COLUMN application_id TEXT;
ALTER TABLE hosting_v2_devices ADD COLUMN capability_mode TEXT NOT NULL DEFAULT 'FULL_HOST'
  CHECK (capability_mode IN ('FULL_HOST','TELEMETRY_ONLY'));
CREATE INDEX IF NOT EXISTS hosting_v2_devices_application_idx
  ON hosting_v2_devices(application_id,capability_mode,status);
