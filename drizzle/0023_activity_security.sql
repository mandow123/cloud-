CREATE TABLE IF NOT EXISTS activity_rate_limits (
  scope TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL CHECK(request_count > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope, actor_id, window_start)
);

CREATE TABLE IF NOT EXISTS activity_submission_commands (
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  submission_id TEXT NOT NULL REFERENCES activity_submissions(id),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS activity_admin_command_receipts (
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  command_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_activity_rate_limits_updated ON activity_rate_limits(updated_at);

PRAGMA optimize;
