export const ACTIVITY_SCHEMA_VERSION = 2;

export const activitySchemaStatements = [
  `CREATE TABLE IF NOT EXISTS activity_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activity_campaigns (
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
  )`,
  `CREATE TABLE IF NOT EXISTS activity_submissions (
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
  )`,
  `CREATE TABLE IF NOT EXISTS activity_votes (
    submission_id TEXT NOT NULL REFERENCES activity_submissions(id) ON DELETE CASCADE,
    voter_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(submission_id, voter_id)
  )`,
  `CREATE TABLE IF NOT EXISTS activity_rewards (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES activity_submissions(id),
    recipient_id TEXT NOT NULL,
    units INTEGER NOT NULL CHECK(units > 0 AND units <= 1000000),
    status TEXT NOT NULL CHECK(status IN ('GRANTED','REVOKED')),
    reason TEXT NOT NULL,
    granted_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activity_audit_events (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    target_id TEXT,
    metadata_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activity_admin_commands (
    idempotency_key TEXT PRIMARY KEY,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activity_rate_limits (
    scope TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    window_start TEXT NOT NULL,
    request_count INTEGER NOT NULL CHECK(request_count > 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(scope, actor_id, window_start)
  )`,
  `CREATE TABLE IF NOT EXISTS activity_submission_commands (
    actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    submission_id TEXT NOT NULL REFERENCES activity_submissions(id),
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(actor_id, idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS activity_admin_command_receipts (
    actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    command_type TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(actor_id, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_activity_submissions_campaign_status_created
    ON activity_submissions(campaign_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_submissions_status_votes
    ON activity_submissions(status, vote_count DESC, created_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_submissions_author_created
    ON activity_submissions(author_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_votes_voter_created
    ON activity_votes(voter_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_rewards_recipient_created
    ON activity_rewards(recipient_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_rate_limits_updated
    ON activity_rate_limits(updated_at)`,
] as const;

export const activityCampaignSeeds = [
  { id: "act_neon_city", slug: "neon-city", title: "霓虹城市重构计划", summary: "用模型重画熟悉街区，让真实地标与未来想象在同一张图里相遇。", status: "ACTIVE", startsAt: "2026-08-12T00:00:00.000Z", endsAt: "2026-09-08T15:59:59.000Z", rewardLabel: "120,000 KAI 时" },
  { id: "act_sound_shape", slug: "sound-shape", title: "把声音变成一座岛", summary: "上传一段声音，以波形、节奏或情绪生成可漫游的视觉岛屿。", status: "ACTIVE", startsAt: "2026-08-19T00:00:00.000Z", endsAt: "2026-09-18T15:59:59.000Z", rewardLabel: "80,000 KAI 时" },
  { id: "act_tiny_world", slug: "tiny-world", title: "掌心里的小世界", summary: "围绕日常物件创作微缩场景，作品与关键提示词一同提交。", status: "UPCOMING", startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-10-01T15:59:59.000Z", rewardLabel: "创作工具包 × 500" },
  { id: "act_open_lab", slug: "open-lab", title: "一百种不可能材质", summary: "每周解锁一种材质词，持续探索新的视觉语言。", status: "EVERGREEN", startsAt: "2026-08-01T00:00:00.000Z", endsAt: null, rewardLabel: "周榜算力加成" },
] as const;
