-- Admin identity, organization membership, sessions and authentication audit.
CREATE TABLE admin_identity_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE admin_user_accounts (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL, primary_email TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(primary_email)
);
CREATE TABLE admin_organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, external_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE admin_memberships (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, organization_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACTIVE','SUSPENDED')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(account_id,organization_id),
  FOREIGN KEY(account_id) REFERENCES admin_user_accounts(id), FOREIGN KEY(organization_id) REFERENCES admin_organizations(id)
);
CREATE TABLE admin_membership_roles (
  membership_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ROLE_ADMIN','INTAKE_OPERATOR','INVENTORY_OPERATOR','VERIFICATION_REVIEWER','MARKET_OPERATOR','FULFILLMENT_OPERATOR','FINANCE_OPERATOR','FINANCE_APPROVER','SUPPORT_READONLY','AUDITOR')),
  granted_at TEXT NOT NULL, granted_by TEXT, PRIMARY KEY(membership_id,role),
  FOREIGN KEY(membership_id) REFERENCES admin_memberships(id), FOREIGN KEY(granted_by) REFERENCES admin_user_accounts(id)
);
CREATE TABLE admin_account_identities (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, organization_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('LARK','EMAIL','LOCAL')),
  tenant_key TEXT NOT NULL, provider_subject TEXT NOT NULL, normalized_email TEXT,
  verified_at TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(provider,tenant_key,provider_subject),
  FOREIGN KEY(account_id) REFERENCES admin_user_accounts(id), FOREIGN KEY(organization_id) REFERENCES admin_organizations(id)
);
CREATE UNIQUE INDEX admin_identity_email_idx ON admin_account_identities(normalized_email) WHERE provider='EMAIL';
CREATE TABLE admin_account_sessions (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, organization_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  auth_method TEXT NOT NULL CHECK (auth_method IN ('LARK_OAUTH','EMAIL_OTP','LOCAL_TEST')),
  created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, idle_expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL, revoked_at TEXT,
  FOREIGN KEY(account_id) REFERENCES admin_user_accounts(id), FOREIGN KEY(organization_id) REFERENCES admin_organizations(id),
  CHECK(idle_expires_at>created_at), CHECK(absolute_expires_at>idle_expires_at)
);
CREATE INDEX admin_sessions_account_idx ON admin_account_sessions(account_id,revoked_at,absolute_expires_at);
CREATE TABLE admin_oauth_transactions (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider='LARK'), state_hash TEXT NOT NULL UNIQUE,
  return_path TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT,
  CHECK(expires_at>created_at)
);
CREATE INDEX admin_oauth_expiry_idx ON admin_oauth_transactions(expires_at,consumed_at);
CREATE TABLE admin_email_otp_challenges (
  id TEXT PRIMARY KEY, normalized_email TEXT NOT NULL, otp_digest TEXT NOT NULL, request_fingerprint TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5), created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, consumed_at TEXT, CHECK(expires_at>created_at)
);
CREATE INDEX admin_email_otp_rate_idx ON admin_email_otp_challenges(normalized_email,created_at DESC);
CREATE TABLE admin_auth_audit_events (
  id TEXT PRIMARY KEY, account_id TEXT, organization_id TEXT, session_id TEXT,
  event_type TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('ALLOWED','DENIED','ERROR')),
  target TEXT, metadata_json TEXT NOT NULL, occurred_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES admin_user_accounts(id), FOREIGN KEY(organization_id) REFERENCES admin_organizations(id)
);
CREATE INDEX admin_auth_audit_time_idx ON admin_auth_audit_events(occurred_at DESC,event_type);
CREATE TRIGGER admin_auth_audit_immutable_update BEFORE UPDATE ON admin_auth_audit_events BEGIN SELECT RAISE(ABORT,'admin auth audit immutable'); END;
CREATE TRIGGER admin_auth_audit_immutable_delete BEFORE DELETE ON admin_auth_audit_events BEGIN SELECT RAISE(ABORT,'admin auth audit immutable'); END;
INSERT INTO admin_identity_schema_migrations(version,applied_at) VALUES(1,datetime('now'));
