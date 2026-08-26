PRAGMA defer_foreign_keys=TRUE;

DROP TRIGGER IF EXISTS card_hour_batches_immutable_update;
DROP TRIGGER IF EXISTS card_hour_batches_immutable_delete;
DROP TRIGGER IF EXISTS card_hour_entries_immutable_update;
DROP TRIGGER IF EXISTS card_hour_entries_immutable_delete;

ALTER TABLE card_hour_ledger_entries RENAME TO card_hour_ledger_entries_before_managed_gpu_income;
ALTER TABLE card_hour_ledger_batches RENAME TO card_hour_ledger_batches_before_managed_gpu_income;

CREATE TABLE card_hour_ledger_batches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('TOPUP','ORDER_CAPTURE','ORDER_REFUND','BUYBACK_HOLD','BUYBACK_RELEASE','RENTAL_INCOME','MANAGED_GPU_INCOME','COMMISSION_INCOME','COMMISSION_REVERSAL')),
  business_key TEXT NOT NULL UNIQUE,
  amount_micros INTEGER NOT NULL CHECK (amount_micros > 0),
  status TEXT NOT NULL CHECK (status = 'POSTED'),
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE card_hour_ledger_entries (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  organization_id TEXT,
  account_code TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
  amount_micros INTEGER NOT NULL CHECK (amount_micros > 0),
  balance_after_micros INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES card_hour_ledger_batches(id)
);

INSERT INTO card_hour_ledger_batches(id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at)
SELECT id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at FROM card_hour_ledger_batches_before_managed_gpu_income;

INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at)
SELECT id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at FROM card_hour_ledger_entries_before_managed_gpu_income;

DROP TABLE card_hour_ledger_entries_before_managed_gpu_income;
DROP TABLE card_hour_ledger_batches_before_managed_gpu_income;

CREATE INDEX IF NOT EXISTS card_hour_ledger_org_time_idx ON card_hour_ledger_entries(organization_id,created_at DESC);
CREATE TRIGGER card_hour_batches_immutable_update BEFORE UPDATE ON card_hour_ledger_batches BEGIN SELECT RAISE(ABORT,'card hour batch immutable'); END;
CREATE TRIGGER card_hour_batches_immutable_delete BEFORE DELETE ON card_hour_ledger_batches BEGIN SELECT RAISE(ABORT,'card hour batch immutable'); END;
CREATE TRIGGER card_hour_entries_immutable_update BEFORE UPDATE ON card_hour_ledger_entries BEGIN SELECT RAISE(ABORT,'card hour entry immutable'); END;
CREATE TRIGGER card_hour_entries_immutable_delete BEFORE DELETE ON card_hour_ledger_entries BEGIN SELECT RAISE(ABORT,'card hour entry immutable'); END;

-- 0041 rebuilds card_hour_ledger_batches, so restore the managed-GPU refund
-- evidence guard and immutable sale-event bridge that were installed by 0040.
CREATE TRIGGER managed_gpu_sale_refund_duplicate_guard BEFORE INSERT ON card_hour_ledger_batches
WHEN NEW.operation='ORDER_REFUND' AND NEW.status='POSTED' AND json_extract(NEW.metadata_json,'$.sourceSystem')='HOSTING_V2'
  AND EXISTS(SELECT 1 FROM managed_gpu_compute_sale_events sale
    WHERE sale.hosting_contract_id=json_extract(NEW.metadata_json,'$.orderId') AND sale.event_type IN ('REFUNDED','CHARGEBACK','REVERSAL'))
BEGIN SELECT RAISE(ABORT,'managed gpu sale already reversed'); END;

CREATE TRIGGER managed_gpu_sale_refund_evidence_guard BEFORE INSERT ON card_hour_ledger_batches
WHEN NEW.operation='ORDER_REFUND' AND NEW.status='POSTED' AND json_extract(NEW.metadata_json,'$.sourceSystem')='HOSTING_V2'
  AND EXISTS(SELECT 1 FROM managed_gpu_compute_sale_events sale
    WHERE sale.hosting_contract_id=json_extract(NEW.metadata_json,'$.orderId') AND sale.event_type='CAPTURED')
  AND (length(COALESCE(json_extract(NEW.metadata_json,'$.refundPayloadDigest'),''))<>64
    OR json_extract(NEW.metadata_json,'$.refundPayloadDigest') GLOB '*[^0-9A-Fa-f]*')
BEGIN SELECT RAISE(ABORT,'managed gpu refund evidence required'); END;

CREATE TRIGGER managed_gpu_sale_refund_bridge AFTER INSERT ON card_hour_ledger_batches
WHEN NEW.operation='ORDER_REFUND' AND NEW.status='POSTED' AND json_extract(NEW.metadata_json,'$.sourceSystem')='HOSTING_V2'
BEGIN
  INSERT INTO managed_gpu_compute_sale_events(id,asset_id,hosting_contract_id,acceptance_event_id,capture_batch_id,event_type,accepted_gpu_seconds,card_hour_micros,source_entry_kind,source_entry_status,payload_digest,occurred_at,recorded_at)
  SELECT 'mgcse_refund_'||lower(hex(randomblob(16))),sale.asset_id,sale.hosting_contract_id,sale.acceptance_event_id,NEW.id,'REFUNDED',sale.accepted_gpu_seconds,
    CASE WHEN NEW.amount_micros<sale.card_hour_micros THEN NEW.amount_micros ELSE sale.card_hour_micros END,'MANAGED_GPU_INCOME','POSTED',lower(json_extract(NEW.metadata_json,'$.refundPayloadDigest')),NEW.created_at,NEW.created_at
  FROM managed_gpu_compute_sale_events sale
  WHERE sale.hosting_contract_id=json_extract(NEW.metadata_json,'$.orderId') AND sale.event_type='CAPTURED';
END;

INSERT OR IGNORE INTO card_hour_schema_migrations(version,applied_at) VALUES(8,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
