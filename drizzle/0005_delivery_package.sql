CREATE TABLE IF NOT EXISTS exchange_delivery_packages (
  id TEXT PRIMARY KEY,
  delivery_task_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  supplier_actor_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  environment TEXT NOT NULL CHECK (environment = 'TEST'),
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'VERIFIED', 'REJECTED', 'CLAIMED', 'EXPIRED', 'REVOKED')),
  public_profile_json TEXT NOT NULL,
  submission_evidence_digest TEXT NOT NULL,
  credential_expires_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (delivery_task_id, revision),
  FOREIGN KEY (delivery_task_id) REFERENCES exchange_delivery_tasks(id),
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS exchange_delivery_packages_active_idx
  ON exchange_delivery_packages(delivery_task_id)
  WHERE status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_delivery_packages_ops_idx
  ON exchange_delivery_packages(status, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_delivery_reviews (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL UNIQUE,
  delivery_task_id TEXT NOT NULL,
  reviewer_actor_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('PASS', 'REJECT')),
  verification_method TEXT NOT NULL CHECK (verification_method IN ('MANUAL', 'SIMULATED_TEST')),
  reason TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (package_id) REFERENCES exchange_delivery_packages(id),
  FOREIGN KEY (delivery_task_id) REFERENCES exchange_delivery_tasks(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_delivery_claims (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  buyer_actor_id TEXT NOT NULL,
  claim_code_digest TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  FOREIGN KEY (package_id) REFERENCES exchange_delivery_packages(id),
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_connection_checks (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  delivery_task_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  buyer_actor_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  adapter TEXT NOT NULL CHECK (adapter = 'SIMULATED_TEST'),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'PASSED', 'FAILED')),
  diagnostic_code TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (package_id, attempt),
  FOREIGN KEY (package_id) REFERENCES exchange_delivery_packages(id),
  FOREIGN KEY (delivery_task_id) REFERENCES exchange_delivery_tasks(id),
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS exchange_connection_checks_running_idx
  ON exchange_connection_checks(package_id)
  WHERE status = 'RUNNING';
--> statement-breakpoint
INSERT OR IGNORE INTO exchange_schema_migrations (version, applied_at) VALUES (4, '2026-08-05T00:00:00.000Z');
