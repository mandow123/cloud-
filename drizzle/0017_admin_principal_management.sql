CREATE TABLE IF NOT EXISTS admin_principal_management (
  membership_id TEXT PRIMARY KEY,
  invited_by_principal_id TEXT,
  invited_at TEXT,
  updated_by_principal_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (membership_id) REFERENCES admin_memberships(id),
  FOREIGN KEY (invited_by_principal_id) REFERENCES admin_user_accounts(id),
  FOREIGN KEY (updated_by_principal_id) REFERENCES admin_user_accounts(id)
);
