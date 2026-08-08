-- Additive singleton Root authority. ROOT is virtual and never stored in the assignable role table.
CREATE TABLE IF NOT EXISTS admin_root_membership (
  singleton INTEGER PRIMARY KEY CHECK (singleton=1),
  membership_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  established_via TEXT NOT NULL CHECK (established_via IN ('BOOTSTRAP','LOCAL_CONFIG')),
  established_at TEXT NOT NULL,
  FOREIGN KEY(membership_id) REFERENCES admin_memberships(id),
  FOREIGN KEY(account_id) REFERENCES admin_user_accounts(id),
  FOREIGN KEY(organization_id) REFERENCES admin_organizations(id)
);
CREATE TRIGGER IF NOT EXISTS admin_bootstrap_claim_root
AFTER INSERT ON admin_bootstrap_claim
BEGIN
  INSERT OR IGNORE INTO admin_root_membership(singleton,membership_id,account_id,organization_id,established_via,established_at)
    VALUES(1,NEW.membership_id,NEW.account_id,NEW.organization_id,'BOOTSTRAP',NEW.claimed_at);
END;
INSERT OR IGNORE INTO admin_root_membership(singleton,membership_id,account_id,organization_id,established_via,established_at)
  SELECT 1,membership_id,account_id,organization_id,'BOOTSTRAP',claimed_at
  FROM admin_bootstrap_claim WHERE singleton=1;
CREATE TRIGGER IF NOT EXISTS admin_root_membership_immutable_update
BEFORE UPDATE ON admin_root_membership BEGIN SELECT RAISE(ABORT,'admin root membership immutable'); END;
CREATE TRIGGER IF NOT EXISTS admin_root_membership_immutable_delete
BEFORE DELETE ON admin_root_membership BEGIN SELECT RAISE(ABORT,'admin root membership immutable'); END;
CREATE TRIGGER IF NOT EXISTS admin_root_membership_keep_active
BEFORE UPDATE OF status ON admin_memberships
WHEN NEW.status<>'ACTIVE' AND EXISTS (SELECT 1 FROM admin_root_membership root WHERE root.membership_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'admin root membership must remain active'); END;
INSERT OR IGNORE INTO admin_identity_schema_migrations(version,applied_at) VALUES(3,datetime('now'));
