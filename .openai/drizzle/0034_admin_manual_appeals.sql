-- Additive, rollback-safe manual appeal sidecar. No payment or ledger mutation.
CREATE TABLE IF NOT EXISTS admin_manual_appeal_cases (
  id TEXT PRIMARY KEY, case_number TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL CHECK(source_type='MANUAL_DELIVERY_DEMAND'), source_id TEXT NOT NULL,
  parent_case_id TEXT, buyer_organization_id TEXT NOT NULL, buyer_account_id TEXT NOT NULL,
  supplier_organization_id TEXT,
  category TEXT NOT NULL CHECK(category IN ('DELIVERY_DELAY','CONNECTION_FAILURE','SPEC_MISMATCH','DELIVERY_QUALITY','CANCELLATION_REQUEST','EXTERNAL_PAYMENT_CLAIM','OTHER')),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 120), description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 4000),
  status TEXT NOT NULL CHECK(status IN ('OPEN','TRIAGED','AWAITING_BUYER','AWAITING_SUPPLIER','UNDER_REVIEW','RESOLUTION_PROPOSED','RESOLVED','CLOSED')),
  resolution_outcome TEXT CHECK(resolution_outcome IS NULL OR resolution_outcome IN ('NO_ACTION','REDELIVERY_RECOMMENDED','CANCEL_REQUEST_RECOMMENDED','OFFLINE_REFUND_RECOMMENDED','OTHER')),
  resolution_summary TEXT, assigned_admin_principal_id TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT, closed_at TEXT,
  FOREIGN KEY(parent_case_id) REFERENCES admin_manual_appeal_cases(id),
  FOREIGN KEY(source_id) REFERENCES admin_catalog_purchase_intent_snapshots(demand_id),
  CHECK((status IN ('RESOLUTION_PROPOSED','RESOLVED') AND resolution_outcome IS NOT NULL AND resolution_summary IS NOT NULL) OR (status NOT IN ('RESOLUTION_PROPOSED','RESOLVED','CLOSED') AND resolution_outcome IS NULL AND resolution_summary IS NULL) OR (status='CLOSED' AND ((resolution_outcome IS NULL AND resolution_summary IS NULL) OR (resolution_outcome IS NOT NULL AND resolution_summary IS NOT NULL))))
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_manual_appeal_one_active_source_idx ON admin_manual_appeal_cases(buyer_organization_id,source_type,source_id) WHERE status<>'CLOSED';
CREATE INDEX IF NOT EXISTS admin_manual_appeal_buyer_idx ON admin_manual_appeal_cases(buyer_organization_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS admin_manual_appeal_supplier_idx ON admin_manual_appeal_cases(supplier_organization_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS admin_manual_appeal_queue_idx ON admin_manual_appeal_cases(status,assigned_admin_principal_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS admin_manual_appeal_messages (id TEXT PRIMARY KEY,case_id TEXT NOT NULL,author_type TEXT NOT NULL CHECK(author_type IN ('BUYER','SUPPLIER','ADMIN')),author_principal_id TEXT NOT NULL,author_organization_id TEXT,visibility TEXT NOT NULL CHECK(visibility IN ('PARTIES','ADMIN_ONLY')),body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),created_at TEXT NOT NULL,FOREIGN KEY(case_id) REFERENCES admin_manual_appeal_cases(id));
CREATE INDEX IF NOT EXISTS admin_manual_appeal_messages_case_idx ON admin_manual_appeal_messages(case_id,created_at,id);
CREATE TRIGGER IF NOT EXISTS admin_manual_appeal_messages_immutable_update BEFORE UPDATE ON admin_manual_appeal_messages BEGIN SELECT RAISE(ABORT,'manual appeal message immutable'); END;
CREATE TRIGGER IF NOT EXISTS admin_manual_appeal_messages_immutable_delete BEFORE DELETE ON admin_manual_appeal_messages BEGIN SELECT RAISE(ABORT,'manual appeal message immutable'); END;
CREATE TABLE IF NOT EXISTS admin_manual_appeal_events (id TEXT PRIMARY KEY,case_id TEXT NOT NULL,event_type TEXT NOT NULL CHECK(event_type IN ('CREATE','ASSIGN','TRANSITION','MESSAGE_ADDED','REFUND_RECORD_CREATED','REFUND_PROOF_SUBMITTED','REFUND_PROOF_VERIFIED')),from_status TEXT,to_status TEXT,actor_principal_id TEXT NOT NULL,payload_digest TEXT NOT NULL,occurred_at TEXT NOT NULL,FOREIGN KEY(case_id) REFERENCES admin_manual_appeal_cases(id));
CREATE INDEX IF NOT EXISTS admin_manual_appeal_events_case_idx ON admin_manual_appeal_events(case_id,occurred_at,id);
CREATE TRIGGER IF NOT EXISTS admin_manual_appeal_events_immutable_update BEFORE UPDATE ON admin_manual_appeal_events BEGIN SELECT RAISE(ABORT,'manual appeal event immutable'); END;
CREATE TRIGGER IF NOT EXISTS admin_manual_appeal_events_immutable_delete BEFORE DELETE ON admin_manual_appeal_events BEGIN SELECT RAISE(ABORT,'manual appeal event immutable'); END;
CREATE TABLE IF NOT EXISTS admin_verified_financial_references (id TEXT PRIMARY KEY,buyer_organization_id TEXT NOT NULL,source_system TEXT NOT NULL,source_entity_id TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),currency TEXT NOT NULL,status TEXT NOT NULL CHECK(status='VERIFIED'),evidence_digest TEXT NOT NULL,verified_at TEXT NOT NULL,UNIQUE(source_system,source_entity_id));
CREATE TABLE IF NOT EXISTS admin_manual_appeal_evidence (id TEXT PRIMARY KEY,case_id TEXT NOT NULL,object_ref TEXT NOT NULL,sha256 TEXT NOT NULL,scan_status TEXT NOT NULL CHECK(scan_status='SAFE'),created_by_principal_id TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(case_id) REFERENCES admin_manual_appeal_cases(id));
CREATE TABLE IF NOT EXISTS admin_manual_appeal_offline_refunds (id TEXT PRIMARY KEY,case_id TEXT NOT NULL,supersedes_record_id TEXT,verified_financial_reference_id TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),currency TEXT NOT NULL,method TEXT NOT NULL CHECK(method IN ('BANK_TRANSFER','ALIPAY','WXPAY','OTHER')),masked_reference TEXT,external_reference_hash TEXT,proof_evidence_id TEXT,status TEXT NOT NULL CHECK(status IN ('APPROVED_FOR_OFFLINE_HANDLING','OFFLINE_PROCESSING','PROOF_SUBMITTED','INDEPENDENTLY_VERIFIED','FAILED','CANCELLED')),recorded_by_principal_id TEXT NOT NULL,verified_by_principal_id TEXT,proof_submitted_at TEXT,proof_verified_at TEXT,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(case_id) REFERENCES admin_manual_appeal_cases(id),FOREIGN KEY(supersedes_record_id) REFERENCES admin_manual_appeal_offline_refunds(id),FOREIGN KEY(verified_financial_reference_id) REFERENCES admin_verified_financial_references(id),CHECK(verified_by_principal_id IS NULL OR verified_by_principal_id<>recorded_by_principal_id),CHECK((status='INDEPENDENTLY_VERIFIED' AND verified_by_principal_id IS NOT NULL AND proof_verified_at IS NOT NULL) OR status<>'INDEPENDENTLY_VERIFIED'));
CREATE INDEX IF NOT EXISTS admin_manual_appeal_refunds_case_idx ON admin_manual_appeal_offline_refunds(case_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS admin_manual_appeal_refunds_source_once_idx ON admin_manual_appeal_offline_refunds(case_id,verified_financial_reference_id);
