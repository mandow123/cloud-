import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) { return readFile(new URL(path, import.meta.url), "utf8"); }

test("activity persistence separates structured records from uploaded blobs", async () => {
  const [schema, upload, hosting] = await Promise.all([
    source("../db/activity-schema.ts"), source("../app/api/activity/submissions/route.ts"), source("../.openai/hosting.json"),
  ]);
  assert.match(schema, /activity_submissions/);
  assert.match(schema, /activity_votes/);
  assert.match(schema, /PRIMARY KEY\(submission_id, voter_id\)/);
  assert.match(schema, /activity_rewards/);
  assert.match(upload, /UPLOADS\.put/);
  assert.match(upload, /inspectActivityImage/);
  const hostingConfig = JSON.parse(hosting);
  assert.match(hostingConfig.project_id, /^appgprj_[a-zA-Z0-9]+$/);
  assert.equal(hostingConfig.d1, "DB");
  assert.equal(hostingConfig.r2, "UPLOADS");
});

test("Sites deployment contract validates bindings, migrations and build artifacts", async () => {
  const script = await source("../scripts/ops/validate-sites-build.mjs");
  assert.match(script, /dist\/server\/index\.js/);
  assert.match(script, /0022_activity_platform\.sql/);
  assert.match(script, /hosting\.d1, "DB"/);
  assert.match(script, /hosting\.r2, "UPLOADS"/);
});

test("write APIs require identity, same-origin requests and bounded input", async () => {
  const [identity, upload, vote, admin] = await Promise.all([
    source("../lib/server/activity-identity.ts"), source("../app/api/activity/submissions/route.ts"), source("../app/api/activity/submissions/[id]/vote/route.ts"), source("../app/api/v1/admin/activity/route.ts"),
  ]);
  assert.match(identity, /requireActivityIdentity/);
  assert.match(identity, /assertActivitySameOrigin/);
  assert.match(upload, /ACTIVITY_UPLOAD_MAX_BYTES/);
  assert.match(upload, /ACTIVITY_UPLOAD_TYPES/);
  assert.match(vote, /typeof body\.voted !== "boolean"/);
  assert.match(admin, /requireActivityAdminAccess/);
  assert.match(admin, /idempotency-key/);
  assert.match(identity, /KAI_TRUST_OPENAI_IDENTITY_HEADERS/);
  assert.match(identity, /KAI_ACTIVITY_ADMIN_EMAILS/);
});

test("moderation, voting and rewards are server-authoritative and audited", async () => {
  const store = await source("../lib/server/activity-store.ts");
  assert.match(store, /status='PUBLISHED'/);
  assert.match(store, /INSERT OR IGNORE INTO activity_votes/);
  assert.match(store, /SELECT COUNT\(\*\) FROM activity_votes/);
  assert.match(store, /REWARD_GRANTED/);
  assert.match(store, /REWARD_REVOKED/);
  assert.match(store, /activity_admin_command_receipts/);
  assert.match(store, /payload_hash/);
  assert.match(store, /activity_rate_limits/);
  assert.match(store, /activity_audit_events/);
});

test("private assets are never shared-cacheable and Sites identity trust fails closed", async () => {
  const [asset, identity] = await Promise.all([source("../app/api/activity/assets/[id]/route.ts"), source("../lib/server/activity-identity.ts")]);
  assert.match(asset, /private, no-store/);
  assert.match(asset, /record\.published/);
  assert.match(identity, /KAI_TRUST_OPENAI_IDENTITY_HEADERS !== "1"/);
  assert.match(identity, /configuredAdminEmails/);
  assert.match(identity, /requireAdminPermission/);
});

test("public UI exposes account, upload, gallery, vote and leaderboard flows", async () => {
  const [community, admin] = await Promise.all([source("../components/activity-community.tsx"), source("../components/activity-admin.tsx")]);
  for (const phrase of ["账户登录", "ChatGPT 登录", "提交作品等待审核", "最新公开作品", "能量榜 TOP 10", "我的投稿"]) assert.match(community, new RegExp(phrase));
  for (const phrase of ["审核通过并公开", "拒绝公开", "发放 KAI 奖励", "撤销最近一笔奖励"]) assert.match(admin, new RegExp(phrase));
});
