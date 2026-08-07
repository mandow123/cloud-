CREATE TABLE IF NOT EXISTS admin_refund_executions (
  refund_case_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider='ALIPAY'),
  refund_request_id TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING','SUCCEEDED','FAILED')),
  attempt_count INTEGER NOT NULL CHECK (attempt_count > 0),
  attempted_by TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  provider_transaction_ref TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  last_attempt_at TEXT NOT NULL,
  completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (refund_case_id) REFERENCES admin_approvals(id)
);
CREATE INDEX IF NOT EXISTS admin_refund_executions_status_idx ON admin_refund_executions(status,last_attempt_at);
INSERT OR IGNORE INTO admin_operations_schema_migrations(version,applied_at) VALUES(2,CURRENT_TIMESTAMP);
