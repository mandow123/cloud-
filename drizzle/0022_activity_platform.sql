CREATE TABLE IF NOT EXISTS activity_schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_campaigns (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('UPCOMING','ACTIVE','EVERGREEN','CLOSED')),
  starts_at TEXT,
  ends_at TEXT,
  reward_label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_submissions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES activity_campaigns(id),
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  prompt_excerpt TEXT NOT NULL,
  asset_key TEXT NOT NULL UNIQUE,
  asset_content_type TEXT NOT NULL,
  asset_size INTEGER NOT NULL CHECK(asset_size > 0 AND asset_size <= 10485760),
  status TEXT NOT NULL CHECK(status IN ('PENDING','PUBLISHED','REJECTED')),
  moderation_note TEXT,
  vote_count INTEGER NOT NULL DEFAULT 0 CHECK(vote_count >= 0),
  reward_units INTEGER NOT NULL DEFAULT 0 CHECK(reward_units >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_votes (
  submission_id TEXT NOT NULL REFERENCES activity_submissions(id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(submission_id, voter_id)
);

CREATE TABLE IF NOT EXISTS activity_rewards (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES activity_submissions(id),
  recipient_id TEXT NOT NULL,
  units INTEGER NOT NULL CHECK(units > 0 AND units <= 1000000),
  status TEXT NOT NULL CHECK(status IN ('GRANTED','REVOKED')),
  reason TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  target_id TEXT,
  metadata_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_admin_commands (
  idempotency_key TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_submissions_campaign_status_created ON activity_submissions(campaign_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_submissions_status_votes ON activity_submissions(status, vote_count DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_activity_submissions_author_created ON activity_submissions(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_votes_voter_created ON activity_votes(voter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_rewards_recipient_created ON activity_rewards(recipient_id, created_at DESC);

PRAGMA optimize;
