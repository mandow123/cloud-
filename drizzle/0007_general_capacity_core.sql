CREATE TABLE IF NOT EXISTS exchange_product_capacity_policies (
  id TEXT PRIMARY KEY,
  product_version_id TEXT UNIQUE,
  policy_key TEXT NOT NULL UNIQUE,
  product_code TEXT NOT NULL CHECK (product_code IN ('GPU_COMPUTE', 'MODEL_INSTANCE', 'TOKEN_THROUGHPUT')),
  rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR')),
  fulfillment_model TEXT NOT NULL CHECK (fulfillment_model IN ('GPU_ALLOCATION', 'MODEL_INSTANCE_ALLOCATION', 'TOKEN_THROUGHPUT_RESERVATION')),
  pricing_unit_code TEXT NOT NULL CHECK (pricing_unit_code IN ('GPU_HOUR', 'MODEL_INSTANCE_HOUR', 'M_TOKEN_CAPACITY_HOUR')),
  rate_unit_scale_numerator INTEGER NOT NULL CHECK (rate_unit_scale_numerator > 0),
  rate_unit_scale_denominator INTEGER NOT NULL CHECK (rate_unit_scale_denominator > 0),
  rate_unit_reference_code TEXT NOT NULL CHECK (rate_unit_reference_code IN ('GPU', 'MODEL_INSTANCE', 'M_TOKEN_PER_HOUR')),
  price_basis_base_units INTEGER NOT NULL CHECK (price_basis_base_units > 0),
  feature_status TEXT NOT NULL CHECK (feature_status IN ('ENABLED', 'DISABLED')),
  identity_spec_json TEXT NOT NULL,
  immutable_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_version_id) REFERENCES exchange_product_versions(id),
  CHECK (feature_status = 'DISABLED' OR product_version_id IS NOT NULL),
  CHECK (
    (product_code = 'GPU_COMPUTE' AND rate_unit_code = 'GPU'
      AND fulfillment_model = 'GPU_ALLOCATION' AND pricing_unit_code = 'GPU_HOUR'
      AND rate_unit_scale_numerator = 1 AND rate_unit_scale_denominator = 1
      AND rate_unit_reference_code = 'GPU' AND price_basis_base_units = 3600)
    OR
    (product_code = 'MODEL_INSTANCE' AND rate_unit_code = 'MODEL_INSTANCE'
      AND fulfillment_model = 'MODEL_INSTANCE_ALLOCATION' AND pricing_unit_code = 'MODEL_INSTANCE_HOUR'
      AND rate_unit_scale_numerator = 1 AND rate_unit_scale_denominator = 1
      AND rate_unit_reference_code = 'MODEL_INSTANCE' AND price_basis_base_units = 3600)
    OR
    (product_code = 'TOKEN_THROUGHPUT' AND rate_unit_code = 'MILLI_M_TOKEN_PER_HOUR'
      AND fulfillment_model = 'TOKEN_THROUGHPUT_RESERVATION' AND pricing_unit_code = 'M_TOKEN_CAPACITY_HOUR'
      AND rate_unit_scale_numerator = 1 AND rate_unit_scale_denominator = 1000
      AND rate_unit_reference_code = 'M_TOKEN_PER_HOUR' AND price_basis_base_units = 3600000)
  )
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_product_versions_immutable_update
  BEFORE UPDATE ON exchange_product_versions
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_PRODUCT_VERSION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_product_versions_immutable_delete
  BEFORE DELETE ON exchange_product_versions
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_PRODUCT_VERSION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_product_capacity_policies_immutable_update
  BEFORE UPDATE ON exchange_product_capacity_policies
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_CAPACITY_POLICY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_product_capacity_policies_immutable_delete
  BEFORE DELETE ON exchange_product_capacity_policies
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_CAPACITY_POLICY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_order_contract_snapshots (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  listing_version_id TEXT NOT NULL,
  product_version_id TEXT NOT NULL,
  capacity_policy_id TEXT NOT NULL,
  product_code TEXT NOT NULL CHECK (product_code IN ('GPU_COMPUTE', 'MODEL_INSTANCE', 'TOKEN_THROUGHPUT')),
  rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR')),
  fulfillment_model TEXT NOT NULL CHECK (fulfillment_model IN ('GPU_ALLOCATION', 'MODEL_INSTANCE_ALLOCATION', 'TOKEN_THROUGHPUT_RESERVATION')),
  pricing_unit_code TEXT NOT NULL CHECK (pricing_unit_code IN ('GPU_HOUR', 'MODEL_INSTANCE_HOUR', 'M_TOKEN_CAPACITY_HOUR')),
  rate_units INTEGER NOT NULL CHECK (rate_units > 0),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  capacity_base_units INTEGER NOT NULL CHECK (capacity_base_units > 0),
  unit_price_micros INTEGER NOT NULL CHECK (unit_price_micros > 0),
  price_basis_base_units INTEGER NOT NULL CHECK (price_basis_base_units > 0),
  gross_amount_cents INTEGER NOT NULL CHECK (gross_amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  product_identity_json TEXT NOT NULL,
  sla_json TEXT NOT NULL,
  evidence_policy_version TEXT NOT NULL,
  snapshot_digest TEXT NOT NULL CHECK (
    length(snapshot_digest) = 71 AND substr(snapshot_digest, 1, 7) = 'sha256:'
    AND substr(snapshot_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  FOREIGN KEY (listing_version_id) REFERENCES exchange_listing_versions(id),
  FOREIGN KEY (product_version_id) REFERENCES exchange_product_versions(id),
  FOREIGN KEY (capacity_policy_id) REFERENCES exchange_product_capacity_policies(id),
  CHECK (capacity_base_units = rate_units * duration_seconds)
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_order_contract_snapshots_immutable_update
  BEFORE UPDATE ON exchange_order_contract_snapshots
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_ORDER_CONTRACT_SNAPSHOT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_order_contract_snapshots_immutable_delete
  BEFORE DELETE ON exchange_order_contract_snapshots
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_ORDER_CONTRACT_SNAPSHOT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_meter_intervals (
  id TEXT PRIMARY KEY,
  metering_session_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  capacity_policy_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  interval_start_at TEXT NOT NULL,
  interval_end_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  reserved_rate_units INTEGER NOT NULL CHECK (reserved_rate_units > 0),
  proven_rate_units INTEGER NOT NULL CHECK (proven_rate_units >= 0),
  scheduled_capacity_base_units INTEGER NOT NULL CHECK (scheduled_capacity_base_units > 0),
  available_capacity_base_units INTEGER NOT NULL CHECK (available_capacity_base_units >= 0),
  unavailable_capacity_base_units INTEGER NOT NULL CHECK (unavailable_capacity_base_units >= 0),
  unproven_capacity_base_units INTEGER NOT NULL CHECK (unproven_capacity_base_units >= 0),
  evidence_status TEXT NOT NULL CHECK (evidence_status IN ('PROVEN', 'UNAVAILABLE', 'UNPROVEN')),
  adapter TEXT NOT NULL CHECK (adapter IN ('TEST', 'CONNECTOR', 'CLOUD_API', 'KAI_GATEWAY')),
  evidence_digest TEXT NOT NULL CHECK (
    length(evidence_digest) = 71 AND substr(evidence_digest, 1, 7) = 'sha256:'
    AND substr(evidence_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  UNIQUE (metering_session_id, sequence_number),
  FOREIGN KEY (metering_session_id) REFERENCES exchange_metering_sessions(id),
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  FOREIGN KEY (capacity_policy_id) REFERENCES exchange_product_capacity_policies(id),
  CHECK (
    length(interval_start_at) = 24
    AND interval_start_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'
    AND unixepoch(interval_start_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%S.000Z', interval_start_at) = interval_start_at
  ),
  CHECK (
    length(interval_end_at) = 24
    AND interval_end_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'
    AND unixepoch(interval_end_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%S.000Z', interval_end_at) = interval_end_at
  ),
  CHECK (unixepoch(interval_end_at) > unixepoch(interval_start_at)),
  CHECK (duration_seconds = unixepoch(interval_end_at) - unixepoch(interval_start_at)),
  CHECK (proven_rate_units <= reserved_rate_units),
  CHECK (scheduled_capacity_base_units = reserved_rate_units * duration_seconds),
  CHECK (available_capacity_base_units + unavailable_capacity_base_units = scheduled_capacity_base_units),
  CHECK (unproven_capacity_base_units <= unavailable_capacity_base_units),
  CHECK (available_capacity_base_units <= scheduled_capacity_base_units)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_meter_intervals_session_idx
  ON exchange_meter_intervals(metering_session_id, interval_start_at, interval_end_at);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_meter_intervals_no_overlap
  BEFORE INSERT ON exchange_meter_intervals
  WHEN EXISTS (
    SELECT 1 FROM exchange_meter_intervals existing
    WHERE existing.metering_session_id = NEW.metering_session_id
      AND existing.interval_start_at < NEW.interval_end_at
      AND existing.interval_end_at > NEW.interval_start_at
  )
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_METER_INTERVAL_OVERLAP'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_meter_intervals_immutable_update
  BEFORE UPDATE ON exchange_meter_intervals
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_METER_INTERVAL_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_meter_intervals_immutable_delete
  BEFORE DELETE ON exchange_meter_intervals
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_METER_INTERVAL_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_meter_evidence (
  id TEXT PRIMARY KEY,
  meter_interval_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('AVAILABILITY', 'MODEL_IDENTITY', 'THROUGHPUT', 'INSTANCE_HEARTBEAT')),
  source TEXT NOT NULL CHECK (source IN ('TEST', 'CONNECTOR', 'CLOUD_API', 'KAI_GATEWAY')),
  model_identity_digest TEXT CHECK (
    model_identity_digest IS NULL OR (
      length(model_identity_digest) = 71 AND substr(model_identity_digest, 1, 7) = 'sha256:'
      AND substr(model_identity_digest, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  payload_digest TEXT NOT NULL CHECK (
    length(payload_digest) = 71 AND substr(payload_digest, 1, 7) = 'sha256:'
    AND substr(payload_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  observed_at TEXT NOT NULL CHECK (
    length(observed_at) = 24
    AND observed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'
    AND unixepoch(observed_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%S.000Z', observed_at) = observed_at
  ),
  created_at TEXT NOT NULL,
  UNIQUE (meter_interval_id, evidence_type, payload_digest),
  FOREIGN KEY (meter_interval_id) REFERENCES exchange_meter_intervals(id),
  CHECK (evidence_type <> 'MODEL_IDENTITY' OR model_identity_digest IS NOT NULL)
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_meter_evidence_observed_within_interval
  BEFORE INSERT ON exchange_meter_evidence
  WHEN NOT EXISTS (
    SELECT 1 FROM exchange_meter_intervals interval
    WHERE interval.id = NEW.meter_interval_id
      AND NEW.observed_at >= interval.interval_start_at
      AND NEW.observed_at <= interval.interval_end_at
  )
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_METER_EVIDENCE_OUTSIDE_INTERVAL'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_meter_evidence_immutable_update
  BEFORE UPDATE ON exchange_meter_evidence
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_METER_EVIDENCE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS exchange_meter_evidence_immutable_delete
  BEFORE DELETE ON exchange_meter_evidence
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_METER_EVIDENCE_IMMUTABLE'); END;
--> statement-breakpoint
INSERT OR IGNORE INTO exchange_product_capacity_policies (
  id, product_version_id, policy_key, product_code, rate_unit_code, fulfillment_model,
  pricing_unit_code, rate_unit_scale_numerator, rate_unit_scale_denominator,
  rate_unit_reference_code, price_basis_base_units, feature_status,
  identity_spec_json, immutable_hash, created_at
) VALUES
  ('PCP-GPU-H100-SXM5-80GB-V1', 'PV-GPU-H100-SXM5-80GB', 'gpu-h100-sxm5-80gb-v1', 'GPU_COMPUTE', 'GPU', 'GPU_ALLOCATION',
    'GPU_HOUR', 1, 1, 'GPU', 3600, 'ENABLED', '{"identity":"GPU_PRODUCT_VERSION","capacityBaseUnit":"GPU_SECOND"}', 'policy:gpu:h100-sxm5-80gb:v1', '2026-08-05T00:00:00.000Z'),
  ('PCP-GPU-H100-PCIE-80GB-V1', 'PV-GPU-H100-PCIE-80GB', 'gpu-h100-pcie-80gb-v1', 'GPU_COMPUTE', 'GPU', 'GPU_ALLOCATION',
    'GPU_HOUR', 1, 1, 'GPU', 3600, 'ENABLED', '{"identity":"GPU_PRODUCT_VERSION","capacityBaseUnit":"GPU_SECOND"}', 'policy:gpu:h100-pcie-80gb:v1', '2026-08-05T00:00:00.000Z'),
  ('PCP-GPU-A100-SXM4-80GB-V1', 'PV-GPU-A100-SXM4-80GB', 'gpu-a100-sxm4-80gb-v1', 'GPU_COMPUTE', 'GPU', 'GPU_ALLOCATION',
    'GPU_HOUR', 1, 1, 'GPU', 3600, 'ENABLED', '{"identity":"GPU_PRODUCT_VERSION","capacityBaseUnit":"GPU_SECOND"}', 'policy:gpu:a100-sxm4-80gb:v1', '2026-08-05T00:00:00.000Z'),
  ('PCP-GPU-H20-PCIE-96GB-V1', 'PV-GPU-H20-PCIE-96GB', 'gpu-h20-pcie-96gb-v1', 'GPU_COMPUTE', 'GPU', 'GPU_ALLOCATION',
    'GPU_HOUR', 1, 1, 'GPU', 3600, 'ENABLED', '{"identity":"GPU_PRODUCT_VERSION","capacityBaseUnit":"GPU_SECOND"}', 'policy:gpu:h20-pcie-96gb:v1', '2026-08-05T00:00:00.000Z'),
  ('PCP-TEMPLATE-MODEL-INSTANCE-V1', NULL, 'template-model-instance-v1', 'MODEL_INSTANCE', 'MODEL_INSTANCE', 'MODEL_INSTANCE_ALLOCATION',
    'MODEL_INSTANCE_HOUR', 1, 1, 'MODEL_INSTANCE', 3600, 'DISABLED', '{"canonicalModelRequired":true,"modelRevisionRequired":true,"serviceTierRequired":true,"contextBucketRequired":true,"quantizationRequired":true,"capacityBaseUnit":"MODEL_INSTANCE_SECOND"}', 'policy-template:model-instance:v1', '2026-08-05T00:00:00.000Z'),
  ('PCP-TEMPLATE-TOKEN-THROUGHPUT-V1', NULL, 'template-token-throughput-v1', 'TOKEN_THROUGHPUT', 'MILLI_M_TOKEN_PER_HOUR', 'TOKEN_THROUGHPUT_RESERVATION',
    'M_TOKEN_CAPACITY_HOUR', 1, 1000, 'M_TOKEN_PER_HOUR', 3600000, 'DISABLED', '{"canonicalModelRequired":true,"modelRevisionRequired":true,"serviceTierRequired":true,"contextBucketRequired":true,"throughputDimensionRequired":true,"rateUnit":"0.001_M_TOKEN_PER_HOUR","capacityBaseUnit":"MILLI_M_TOKEN_PER_HOUR_SECOND"}', 'policy-template:token-throughput:v1', '2026-08-05T00:00:00.000Z');
--> statement-breakpoint
INSERT OR IGNORE INTO exchange_schema_migrations (version, applied_at) VALUES (7, '2026-08-05T00:00:00.000Z');
