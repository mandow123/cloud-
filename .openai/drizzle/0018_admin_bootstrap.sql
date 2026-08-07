-- One-time, race-safe bootstrap of the first active KAI administrator.
CREATE TABLE IF NOT EXISTS admin_bootstrap_claim (
  singleton INTEGER PRIMARY KEY CHECK (singleton=1),
  membership_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  FOREIGN KEY(membership_id) REFERENCES admin_memberships(id),
  FOREIGN KEY(account_id) REFERENCES admin_user_accounts(id),
  FOREIGN KEY(organization_id) REFERENCES admin_organizations(id),
  FOREIGN KEY(session_id) REFERENCES admin_account_sessions(id)
);
CREATE TRIGGER IF NOT EXISTS admin_bootstrap_claim_activate
AFTER INSERT ON admin_bootstrap_claim
BEGIN
  UPDATE admin_memberships
    SET status='ACTIVE',updated_at=NEW.claimed_at
    WHERE id=NEW.membership_id AND account_id=NEW.account_id AND organization_id=NEW.organization_id;
  INSERT OR IGNORE INTO admin_membership_roles(membership_id,role,granted_at,granted_by)
    VALUES(NEW.membership_id,'ROLE_ADMIN',NEW.claimed_at,NEW.account_id);
  INSERT INTO admin_auth_audit_events(id,account_id,organization_id,session_id,event_type,outcome,target,metadata_json,occurred_at)
    VALUES('aae_bootstrap_' || NEW.membership_id,NEW.account_id,NEW.organization_id,NEW.session_id,'ADMIN_BOOTSTRAP_SUCCEEDED','ALLOWED','/api/auth/bootstrap-admin','{}',NEW.claimed_at);
END;
CREATE TRIGGER IF NOT EXISTS admin_bootstrap_claim_immutable_update
BEFORE UPDATE ON admin_bootstrap_claim BEGIN SELECT RAISE(ABORT,'admin bootstrap claim immutable'); END;
CREATE TRIGGER IF NOT EXISTS admin_bootstrap_claim_immutable_delete
BEFORE DELETE ON admin_bootstrap_claim BEGIN SELECT RAISE(ABORT,'admin bootstrap claim immutable'); END;
INSERT OR IGNORE INTO admin_identity_schema_migrations(version,applied_at) VALUES(2,datetime('now'));
