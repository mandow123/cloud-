CREATE TABLE IF NOT EXISTS standardization_schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS standardization_policies (
  version TEXT PRIMARY KEY,
  unit_code TEXT NOT NULL CHECK (unit_code = 'KAI-SCH'),
  benchmark_label TEXT NOT NULL,
  min_sample_count INTEGER NOT NULL CHECK (min_sample_count >= 3),
  formula TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO standardization_policies (
  version,unit_code,benchmark_label,min_sample_count,formula,created_at
) VALUES (
  'KAI-SCH-V1','KAI-SCH','H100 SXM5 80GB GPU 卡时市场中位价',5,
  'NATIVE_MARKET_PRICE_DIVIDED_BY_KAI_BENCHMARK_P50','2026-08-08T00:00:00.000Z'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS standardization_snapshot_batches (
  id TEXT PRIMARY KEY,
  policy_version TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  as_of TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  publish_reason TEXT NOT NULL CHECK (length(publish_reason) BETWEEN 8 AND 500),
  benchmark_p25_cny_micros TEXT NOT NULL CHECK (benchmark_p25_cny_micros GLOB '[1-9][0-9]*'),
  benchmark_p50_cny_micros TEXT NOT NULL CHECK (benchmark_p50_cny_micros GLOB '[1-9][0-9]*'),
  benchmark_p75_cny_micros TEXT NOT NULL CHECK (benchmark_p75_cny_micros GLOB '[1-9][0-9]*'),
  benchmark_sample_count INTEGER NOT NULL CHECK (benchmark_sample_count >= 5),
  source_sample_count INTEGER NOT NULL CHECK (source_sample_count >= benchmark_sample_count),
  promotional_excluded_count INTEGER NOT NULL CHECK (promotional_excluded_count >= 0),
  snapshot_digest TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE (actor_id,idempotency_key),
  UNIQUE (policy_version,as_of),
  FOREIGN KEY (policy_version) REFERENCES standardization_policies(version),
  CHECK (expires_at > as_of)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS standardization_snapshot_batches_latest_idx
  ON standardization_snapshot_batches(policy_version,as_of DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS standardization_samples (
  batch_id TEXT NOT NULL,
  sample_id TEXT NOT NULL,
  product_code TEXT NOT NULL CHECK (product_code IN ('GPU_COMPUTE','MODEL_INSTANCE','TOKEN_THROUGHPUT','NAS_STORAGE','RACK_SPACE')),
  product_version_id TEXT NOT NULL,
  region TEXT NOT NULL,
  unit_price_cny_micros TEXT NOT NULL CHECK (unit_price_cny_micros GLOB '[1-9][0-9]*'),
  is_benchmark INTEGER NOT NULL CHECK (is_benchmark IN (0,1)),
  promotional INTEGER NOT NULL CHECK (promotional IN (0,1)),
  market_index_eligible INTEGER NOT NULL CHECK (market_index_eligible IN (0,1)),
  source_system TEXT NOT NULL CHECK (source_system IN ('MARKETPLACE','EXCHANGE','SUPPLY_PILOT','CLOUD_VENDOR')),
  included_in_index INTEGER NOT NULL CHECK (included_in_index IN (0,1)),
  exclusion_reason TEXT CHECK (exclusion_reason IN ('PROMOTIONAL','NOT_INDEX_ELIGIBLE','SUPPLY_PILOT','STALE_SAMPLE')),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (batch_id,sample_id),
  FOREIGN KEY (batch_id) REFERENCES standardization_snapshot_batches(id),
  CHECK ((included_in_index=1 AND exclusion_reason IS NULL) OR (included_in_index=0 AND exclusion_reason IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS standardization_quote_snapshots (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  product_code TEXT NOT NULL CHECK (product_code IN ('GPU_COMPUTE','MODEL_INSTANCE','TOKEN_THROUGHPUT','NAS_STORAGE','RACK_SPACE')),
  product_version_id TEXT NOT NULL,
  product_label TEXT NOT NULL,
  native_unit_code TEXT NOT NULL,
  native_unit_label TEXT NOT NULL,
  region TEXT NOT NULL,
  p25_cny_micros TEXT NOT NULL CHECK (p25_cny_micros GLOB '[1-9][0-9]*'),
  p50_cny_micros TEXT NOT NULL CHECK (p50_cny_micros GLOB '[1-9][0-9]*'),
  p75_cny_micros TEXT NOT NULL CHECK (p75_cny_micros GLOB '[1-9][0-9]*'),
  p25_kai_sch_micros TEXT NOT NULL CHECK (p25_kai_sch_micros GLOB '[0-9]*'),
  p50_kai_sch_micros TEXT NOT NULL CHECK (p50_kai_sch_micros GLOB '[0-9]*'),
  p75_kai_sch_micros TEXT NOT NULL CHECK (p75_kai_sch_micros GLOB '[0-9]*'),
  sample_count INTEGER NOT NULL CHECK (sample_count >= 5),
  promotional_excluded_count INTEGER NOT NULL CHECK (promotional_excluded_count >= 0),
  as_of TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  snapshot_digest TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE (batch_id,product_code,product_version_id,region),
  FOREIGN KEY (batch_id) REFERENCES standardization_snapshot_batches(id),
  FOREIGN KEY (policy_version) REFERENCES standardization_policies(version),
  CHECK (expires_at > as_of)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS standardization_quote_snapshots_batch_idx
  ON standardization_quote_snapshots(batch_id,product_code,product_version_id,region);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS standardization_command_receipts (
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_id,idempotency_key),
  FOREIGN KEY (batch_id) REFERENCES standardization_snapshot_batches(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS standardization_audit_events (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type = 'SNAPSHOT_PUBLISHED'),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 8 AND 500),
  payload_hash TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES standardization_snapshot_batches(id)
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS standardization_policies_immutable_update
BEFORE UPDATE ON standardization_policies BEGIN SELECT RAISE(ABORT,'STANDARDIZATION_POLICY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS standardization_policies_immutable_delete
BEFORE DELETE ON standardization_policies BEGIN SELECT RAISE(ABORT,'STANDARDIZATION_POLICY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS standardization_snapshot_batches_immutable_update
BEFORE UPDATE ON standardization_snapshot_batches BEGIN SELECT RAISE(ABORT,'STANDARDIZATION_SNAPSHOT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS standardization_snapshot_batches_immutable_delete
BEFORE DELETE ON standardization_snapshot_batches BEGIN SELECT RAISE(ABORT,'STANDARDIZATION_SNAPSHOT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS standardization_samples_immutable_update
BEFORE UPDATE ON standardization_samples BEGIN SELECT RAISE(ABORT,'STANDARDIZATION_SAMPLE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS standardization_samples_immutable_delete
BEFORE DELETE ON standardization_samples BEGIN SELECT RAISE(ABORT,'STANDARDIZATION_SAMPLE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS standardization_quote_snapshots_immutable_update
BEFORE UPDATE ON standardization_quote_snapshots BEGIN SELECT RAISE(ABORT,'STANDARDIZATION_QUOTE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS standardization_quote_snapshots_immutable_delete
BEFORE DELETE ON standardization_quote_snapshots BEGIN SELECT RAISE(ABORT,'STANDARDIZATION_QUOTE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS standardization_audit_events_immutable_update
BEFORE UPDATE ON standardization_audit_events BEGIN SELECT RAISE(ABORT,'STANDARDIZATION_AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS standardization_audit_events_immutable_delete
BEFORE DELETE ON standardization_audit_events BEGIN SELECT RAISE(ABORT,'STANDARDIZATION_AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
INSERT OR IGNORE INTO standardization_schema_migrations(version,applied_at)
VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
