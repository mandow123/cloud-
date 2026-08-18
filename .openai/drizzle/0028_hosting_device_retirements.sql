CREATE TABLE IF NOT EXISTS hosting_v2_device_retirements (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('GRACEFUL','EMERGENCY')),
  status TEXT NOT NULL CHECK (status IN ('DRAINING','MANUAL_ACTION_REQUIRED','FINALIZED')),
  reason_code TEXT NOT NULL CHECK (length(trim(reason_code)) > 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  evidence_digest TEXT,
  requested_by TEXT NOT NULL CHECK (length(trim(requested_by)) > 0),
  requested_at TEXT NOT NULL,
  finalized_by TEXT,
  finalized_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (
    (status='FINALIZED' AND finalized_by IS NOT NULL AND finalized_at IS NOT NULL)
    OR
    (status IN ('DRAINING','MANUAL_ACTION_REQUIRED') AND finalized_by IS NULL AND finalized_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS hosting_v2_device_retirements_org_status_idx
  ON hosting_v2_device_retirements(organization_id,status,requested_at DESC);
CREATE TRIGGER IF NOT EXISTS hosting_v2_device_retirement_identity_immutable
  BEFORE UPDATE ON hosting_v2_device_retirements
  WHEN OLD.id<>NEW.id OR OLD.device_id<>NEW.device_id OR OLD.organization_id<>NEW.organization_id
    OR OLD.mode<>NEW.mode OR OLD.reason_code<>NEW.reason_code OR OLD.reason<>NEW.reason
    OR OLD.requested_by<>NEW.requested_by OR OLD.requested_at<>NEW.requested_at
    OR (OLD.evidence_digest IS NOT NULL AND COALESCE(NEW.evidence_digest,'')<>OLD.evidence_digest)
  BEGIN SELECT RAISE(ABORT, 'hosting device retirement identity immutable'); END;
CREATE TRIGGER IF NOT EXISTS hosting_v2_device_retirement_status_guard
  BEFORE UPDATE ON hosting_v2_device_retirements
  WHEN NOT (
    NEW.version=OLD.version+1
    AND (
      (OLD.status='DRAINING' AND NEW.status IN ('DRAINING','MANUAL_ACTION_REQUIRED','FINALIZED'))
      OR (OLD.status='MANUAL_ACTION_REQUIRED' AND NEW.status IN ('MANUAL_ACTION_REQUIRED','FINALIZED'))
    )
  )
  BEGIN SELECT RAISE(ABORT, 'hosting device retirement status transition invalid'); END;
CREATE TRIGGER IF NOT EXISTS hosting_v2_device_retirement_immutable_delete
  BEFORE DELETE ON hosting_v2_device_retirements
  BEGIN SELECT RAISE(ABORT, 'hosting device retirement immutable'); END;

INSERT OR IGNORE INTO hosting_v2_schema_migrations(version,applied_at) VALUES(14,datetime('now'));
