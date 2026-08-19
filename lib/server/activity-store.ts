import { ACTIVITY_SCHEMA_VERSION, activityCampaignSeeds, activitySchemaStatements } from "../../db/activity-schema.ts";
import type { ActivityCampaign, ActivityIdentity, ActivitySnapshot, ActivitySubmission } from "../activity-types.ts";
import type { ActivityD1, D1Statement } from "./activity-env.ts";
import { ActivityHttpError } from "./activity-identity.ts";

type Row = Record<string, unknown>;
const text = (row: Row, key: string) => String(row[key] ?? "");
const nullableText = (row: Row, key: string) => row[key] == null ? null : String(row[key]);
const number = (row: Row, key: string) => Number(row[key] ?? 0);

function campaign(row: Row): ActivityCampaign {
  return { id: text(row, "id"), slug: text(row, "slug"), title: text(row, "title"), summary: text(row, "summary"), status: text(row, "status") as ActivityCampaign["status"], startsAt: nullableText(row, "starts_at"), endsAt: nullableText(row, "ends_at"), rewardLabel: text(row, "reward_label") };
}

function submission(row: Row): ActivitySubmission {
  const id = text(row, "id");
  return { id, campaignId: text(row, "campaign_id"), campaignTitle: text(row, "campaign_title"), authorName: text(row, "author_name"), title: text(row, "title"), description: text(row, "description"), promptExcerpt: text(row, "prompt_excerpt"), status: text(row, "status") as ActivitySubmission["status"], voteCount: number(row, "vote_count"), rewardUnits: number(row, "reward_units"), createdAt: text(row, "created_at"), assetUrl: `/api/activity/assets/${encodeURIComponent(id)}`, votedByViewer: number(row, "viewer_voted") === 1 };
}

async function ensureSchema(db: ActivityD1) {
  const statements: D1Statement[] = activitySchemaStatements.map((sql) => db.prepare(sql));
  await db.batch(statements);
  const now = new Date().toISOString();
  await db.prepare("INSERT OR IGNORE INTO activity_schema_migrations(version,applied_at) VALUES(?,?)").bind(ACTIVITY_SCHEMA_VERSION, now).run();
  await db.batch(activityCampaignSeeds.map((item) => db.prepare(`INSERT OR IGNORE INTO activity_campaigns(id,slug,title,summary,status,starts_at,ends_at,reward_label,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(item.id, item.slug, item.title, item.summary, item.status, item.startsAt, item.endsAt, item.rewardLabel, now, now)));
}

async function rows<T extends Row>(statement: D1Statement) { return (await statement.all<T>()).results ?? []; }

const submissionSelect = `SELECT s.*,c.title AS campaign_title`;
const submissionFrom = `FROM activity_submissions s JOIN activity_campaigns c ON c.id=s.campaign_id`;

export async function readActivitySnapshot(db: ActivityD1, viewer: ActivityIdentity | null): Promise<ActivitySnapshot> {
  await ensureSchema(db);
  const campaigns = (await rows<Row>(db.prepare("SELECT * FROM activity_campaigns ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'EVERGREEN' THEN 1 WHEN 'UPCOMING' THEN 2 ELSE 3 END,starts_at"))).map(campaign);
  const viewerId = viewer?.id ?? "";
  const published = await rows<Row>(db.prepare(`${submissionSelect},EXISTS(SELECT 1 FROM activity_votes v WHERE v.submission_id=s.id AND v.voter_id=?) AS viewer_voted ${submissionFrom} WHERE s.status='PUBLISHED' ORDER BY s.created_at DESC LIMIT 60`).bind(viewerId));
  const leaders = await rows<Row>(db.prepare(`${submissionSelect},EXISTS(SELECT 1 FROM activity_votes v WHERE v.submission_id=s.id AND v.voter_id=?) AS viewer_voted ${submissionFrom} WHERE s.status='PUBLISHED' ORDER BY s.vote_count DESC,s.created_at ASC LIMIT 20`).bind(viewerId));
  const mine = viewer ? await rows<Row>(db.prepare(`${submissionSelect},0 AS viewer_voted ${submissionFrom} WHERE s.author_id=? ORDER BY s.created_at DESC LIMIT 30`).bind(viewer.id)) : [];
  const reward = viewer ? await db.prepare("SELECT COALESCE(SUM(units),0) AS balance FROM activity_rewards WHERE recipient_id=? AND status='GRANTED'").bind(viewer.id).first<Row>() : null;
  return { campaigns, submissions: published.map(submission), leaderboard: leaders.map(submission), viewer, mySubmissions: mine.map(submission), rewardBalance: number(reward ?? {}, "balance") };
}

export async function createActivitySubmission(db: ActivityD1, input: { campaignId: string; author: ActivityIdentity; title: string; description: string; promptExcerpt: string; assetKey: string; contentType: string; size: number; now?: Date }) {
  await ensureSchema(db);
  const now = input.now ?? new Date();
  const recent = await db.prepare("SELECT COUNT(*) AS count FROM activity_submissions WHERE author_id=? AND created_at>=?").bind(input.author.id, new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()).first<Row>();
  if (number(recent ?? {}, "count") >= 10) throw new ActivityHttpError("ACTIVITY_SUBMISSION_RATE_LIMITED", 429, "每天最多提交 10 件作品。 ");
  const campaignRow = await db.prepare("SELECT id,status,starts_at,ends_at FROM activity_campaigns WHERE id=?").bind(input.campaignId).first<Row>();
  if (!campaignRow || !["ACTIVE", "EVERGREEN"].includes(text(campaignRow, "status"))) throw new ActivityHttpError("ACTIVITY_CAMPAIGN_CLOSED", 409, "该活动当前不接受投稿。 ");
  const nowMs = now.getTime();
  if (campaignRow.starts_at && Date.parse(text(campaignRow, "starts_at")) > nowMs || campaignRow.ends_at && Date.parse(text(campaignRow, "ends_at")) <= nowMs) throw new ActivityHttpError("ACTIVITY_CAMPAIGN_CLOSED", 409, "该活动当前不接受投稿。 ");
  const id = `sub_${crypto.randomUUID()}`;
  const at = now.toISOString();
  await db.batch([
    db.prepare(`INSERT INTO activity_submissions(id,campaign_id,author_id,author_name,title,description,prompt_excerpt,asset_key,asset_content_type,asset_size,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'PENDING',?,?)`).bind(id, input.campaignId, input.author.id, input.author.displayName, input.title, input.description, input.promptExcerpt, input.assetKey, input.contentType, input.size, at, at),
    db.prepare("INSERT INTO activity_audit_events(id,actor_id,event_type,target_id,metadata_json,occurred_at) VALUES(?,?,?,?,?,?)").bind(`aae_${crypto.randomUUID()}`, input.author.id, "SUBMISSION_CREATED", id, JSON.stringify({ campaignId: input.campaignId, contentType: input.contentType, size: input.size }), at),
  ]);
  return id;
}

export async function setActivityVote(db: ActivityD1, submissionId: string, voter: ActivityIdentity, desired: boolean, now = new Date()) {
  await ensureSchema(db);
  const recent = await db.prepare("SELECT COUNT(*) AS count FROM activity_votes WHERE voter_id=? AND created_at>=?").bind(voter.id, new Date(now.getTime() - 60 * 60 * 1000).toISOString()).first<Row>();
  if (number(recent ?? {}, "count") >= 120) throw new ActivityHttpError("ACTIVITY_VOTE_RATE_LIMITED", 429, "投票过于频繁，请稍后再试。 ");
  const target = await db.prepare("SELECT status FROM activity_submissions WHERE id=?").bind(submissionId).first<Row>();
  if (!target || text(target, "status") !== "PUBLISHED") throw new ActivityHttpError("ACTIVITY_SUBMISSION_NOT_FOUND", 404, "作品不存在或尚未公开。 ");
  const at = now.toISOString();
  if (!desired) {
    await db.batch([
      db.prepare("DELETE FROM activity_votes WHERE submission_id=? AND voter_id=?").bind(submissionId, voter.id),
      db.prepare("UPDATE activity_submissions SET vote_count=(SELECT COUNT(*) FROM activity_votes WHERE submission_id=?),updated_at=? WHERE id=?").bind(submissionId, at, submissionId),
      db.prepare("INSERT INTO activity_audit_events(id,actor_id,event_type,target_id,metadata_json,occurred_at) VALUES(?,?,?,?,?,?)").bind(`aae_${crypto.randomUUID()}`, voter.id, "VOTE_REMOVED", submissionId, "{}", at),
    ]);
    return { voted: false };
  }
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO activity_votes(submission_id,voter_id,created_at) VALUES(?,?,?)").bind(submissionId, voter.id, at),
    db.prepare("UPDATE activity_submissions SET vote_count=(SELECT COUNT(*) FROM activity_votes WHERE submission_id=?),updated_at=? WHERE id=?").bind(submissionId, at, submissionId),
    db.prepare("INSERT INTO activity_audit_events(id,actor_id,event_type,target_id,metadata_json,occurred_at) VALUES(?,?,?,?,?,?)").bind(`aae_${crypto.randomUUID()}`, voter.id, "VOTE_ADDED", submissionId, "{}", at),
  ]);
  return { voted: true };
}

export async function readActivityAssetRecord(db: ActivityD1, submissionId: string, viewerId?: string, admin = false) {
  await ensureSchema(db);
  const row = await db.prepare("SELECT asset_key,asset_content_type,status,author_id FROM activity_submissions WHERE id=?").bind(submissionId).first<Row>();
  if (!row || (text(row, "status") !== "PUBLISHED" && !admin && text(row, "author_id") !== viewerId)) return null;
  return { key: text(row, "asset_key"), contentType: text(row, "asset_content_type") };
}

export async function readActivityAdminRows(db: ActivityD1) {
  await ensureSchema(db);
  return rows<Row>(db.prepare(`${submissionSelect},0 AS viewer_voted ${submissionFrom} ORDER BY CASE s.status WHEN 'PENDING' THEN 0 WHEN 'PUBLISHED' THEN 1 ELSE 2 END,s.created_at DESC LIMIT 500`));
}

export async function moderateActivitySubmission(db: ActivityD1, input: { submissionId: string; action: "PUBLISH" | "REJECT" | "GRANT_REWARD" | "REVOKE_REWARD"; reason: string; units?: number; adminId: string; idempotencyKey: string; now?: Date }) {
  await ensureSchema(db);
  const replay = await db.prepare("SELECT response_json FROM activity_admin_commands WHERE idempotency_key=?").bind(input.idempotencyKey).first<Row>();
  if (replay) return JSON.parse(text(replay, "response_json")) as Record<string, unknown>;
  const row = await db.prepare("SELECT id,author_id,status,reward_units FROM activity_submissions WHERE id=?").bind(input.submissionId).first<Row>();
  if (!row) throw new ActivityHttpError("ACTIVITY_SUBMISSION_NOT_FOUND", 404, "作品不存在。 ");
  const at = (input.now ?? new Date()).toISOString();
  if (input.action === "PUBLISH" || input.action === "REJECT") {
    const next = input.action === "PUBLISH" ? "PUBLISHED" : "REJECTED";
    const response = { status: next };
    await db.batch([
      db.prepare("UPDATE activity_submissions SET status=?,moderation_note=?,updated_at=? WHERE id=?").bind(next, input.reason, at, input.submissionId),
      db.prepare("INSERT INTO activity_audit_events(id,actor_id,event_type,target_id,metadata_json,occurred_at) VALUES(?,?,?,?,?,?)").bind(`aae_${crypto.randomUUID()}`, input.adminId, `SUBMISSION_${next}`, input.submissionId, JSON.stringify({ reason: input.reason }), at),
      db.prepare("INSERT INTO activity_admin_commands(idempotency_key,response_json,created_at) VALUES(?,?,?)").bind(input.idempotencyKey, JSON.stringify(response), at),
    ]);
    return response;
  }
  if (input.action === "GRANT_REWARD") {
    const units = input.units ?? 0;
    if (!Number.isSafeInteger(units) || units < 1 || units > 1_000_000) throw new ActivityHttpError("ACTIVITY_REWARD_INVALID", 400, "奖励数量无效。 ");
    const rewardId = `rew_${crypto.randomUUID()}`;
    const response = { status: text(row, "status"), rewardId, units };
    await db.batch([
      db.prepare("INSERT INTO activity_rewards(id,submission_id,recipient_id,units,status,reason,granted_by,created_at,updated_at) VALUES(?,?,?,?,'GRANTED',?,?,?,?)").bind(rewardId, input.submissionId, text(row, "author_id"), units, input.reason, input.adminId, at, at),
      db.prepare("UPDATE activity_submissions SET reward_units=reward_units+?,updated_at=? WHERE id=?").bind(units, at, input.submissionId),
      db.prepare("INSERT INTO activity_audit_events(id,actor_id,event_type,target_id,metadata_json,occurred_at) VALUES(?,?,?,?,?,?)").bind(`aae_${crypto.randomUUID()}`, input.adminId, "REWARD_GRANTED", input.submissionId, JSON.stringify({ rewardId, units, reason: input.reason }), at),
      db.prepare("INSERT INTO activity_admin_commands(idempotency_key,response_json,created_at) VALUES(?,?,?)").bind(input.idempotencyKey, JSON.stringify(response), at),
    ]);
    return response;
  }
  const reward = await db.prepare("SELECT id,units FROM activity_rewards WHERE submission_id=? AND status='GRANTED' ORDER BY created_at DESC LIMIT 1").bind(input.submissionId).first<Row>();
  if (!reward) throw new ActivityHttpError("ACTIVITY_REWARD_NOT_FOUND", 409, "没有可撤销的奖励。 ");
  const response = { status: text(row, "status"), rewardRevoked: text(reward, "id") };
  await db.batch([
    db.prepare("UPDATE activity_rewards SET status='REVOKED',reason=?,updated_at=? WHERE id=? AND status='GRANTED'").bind(input.reason, at, text(reward, "id")),
    db.prepare("UPDATE activity_submissions SET reward_units=MAX(0,reward_units-?),updated_at=? WHERE id=?").bind(number(reward, "units"), at, input.submissionId),
    db.prepare("INSERT INTO activity_audit_events(id,actor_id,event_type,target_id,metadata_json,occurred_at) VALUES(?,?,?,?,?,?)").bind(`aae_${crypto.randomUUID()}`, input.adminId, "REWARD_REVOKED", input.submissionId, JSON.stringify({ rewardId: text(reward, "id"), reason: input.reason }), at),
    db.prepare("INSERT INTO activity_admin_commands(idempotency_key,response_json,created_at) VALUES(?,?,?)").bind(input.idempotencyKey, JSON.stringify(response), at),
  ]);
  return response;
}
