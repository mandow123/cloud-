import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("manual appeals stay behind the disabled-by-default server feature gate", () => {
  const feature = read("lib/server/manual-appeals.ts");
  const memberPage = read("app/member/purchases/[demandId]/page.tsx");
  const supplyPage = read("app/supply/page.tsx");
  const adminPage = read("app/admin/appeals/page.tsx");
  const adminLayout = read("app/admin/layout.tsx");
  const adminShell = read("components/admin-shell.tsx");
  const compose = read("deploy/compose.production.yml");
  const productionEnv = read("deploy/kai-cloud-app.env.example");
  const productionValidator = read("scripts/ops/validate-production-env.mjs");
  const sqliteMigration = read("drizzle/0034_admin_manual_appeals.sql");
  const d1Migration = read(".openai/drizzle/0034_admin_manual_appeals.sql");
  assert.match(feature, /KAI_MANUAL_APPEALS_V1\?\.trim\(\)===?"1"/u);
  assert.match(memberPage, /appealsEnabled=\{manualAppealsEnabled\(\)\}/u);
  assert.match(supplyPage, /appealsEnabled=\{manualAppealsEnabled\(\)\}/u);
  assert.match(adminPage, /if \(!manualAppealsEnabled\(\)\) notFound\(\)/u);
  assert.match(adminLayout, /appealsEnabled=\{manualAppealsEnabled\(\)\}/u);
  assert.match(adminShell, /requiresManualAppeals[\s\S]*appealsEnabled/u);
  assert.match(compose,/KAI_MANUAL_APPEALS_V1:\s*"\$\{KAI_MANUAL_APPEALS_V1:-0\}"/u);
  assert.match(productionEnv,/^KAI_MANUAL_APPEALS_V1=0$/mu);
  assert.match(productionValidator,/KAI_MANUAL_APPEALS_V1 must be exactly 0 or 1/u);
  assert.equal(d1Migration,sqliteMigration,"D1 and SQLite migration artifacts must stay byte-identical for rollback parity");
});

test("buyer creates and replies to appeals without uploading evidence or moving money", () => {
  const source = read("components/member-manual-appeals.tsx");
  assert.match(source, /marketplaceGet<AppealPayload>\("\/api\/v1\/member\/appeals"\)/u);
  assert.match(source, /\/api\/v1\/member\/purchases\/\$\{encodeURIComponent\(demandId\)\}\/appeals/u);
  assert.match(source, /record\.sourceId === demandId/u);
  assert.match(source, /record\.status !== "CLOSED"/u);
  assert.match(source, /\/api\/v1\/member\/appeals\/\$\{encodeURIComponent\(record\.id\)\}\/messages/u);
  assert.match(source, /\{ category, subject: subject\.trim\(\), description: description\.trim\(\) \}/u);
  assert.match(source, /\{ body: reply\.trim\(\), expectedVersion: record\.version \}/u);
  assert.match(source, /reason instanceof MarketplaceApiError && reason\.status === 409/u);
  assert.match(source, /aria-label="申诉处理时间线"/u);
  assert.match(source, /return "平台处理进度已更新"/u);
  assert.doesNotMatch(source, /evidenceIds|sshPublicKey|connection|buyerEmail|internalNote/u);
  assert.doesNotMatch(source, /退款成功|已退款/u);
});

test("supplier appeal view remains organization-safe and exposes only party messages", () => {
  const source = read("components/supplier-manual-appeals.tsx");
  assert.match(source, /\/api\/v1\/supply\/appeals/u);
  assert.match(source, /\/api\/v1\/supply\/appeals\/\$\{encodeURIComponent\(record\.id\)\}\/messages/u);
  assert.match(source, /\{ body, expectedVersion: record\.version \}/u);
  assert.match(source, /reason instanceof MarketplaceApiError && reason\.status === 409/u);
  assert.match(source, /aria-label="申诉处理时间线"/u);
  assert.match(source, /不包含买家姓名、邮箱、SSH 原文或平台内部备注/u);
  assert.doesNotMatch(source, /buyerDisplayName|buyerOrganizationId|buyerAccountId|canonicalSshPublicKey|internalNote/u);
  assert.doesNotMatch(source, /退款成功|已退款/u);
});

test("admin UI separates case resolution from read-only independently verified proof", () => {
  const source = read("components/admin-manual-appeals.tsx");
  assert.match(source, /\/api\/v1\/admin\/appeals/u);
  assert.match(source, /action === "PROPOSE_RESOLUTION"/u);
  assert.match(source, /visibility, expectedVersion: selected\.version/u);
  assert.match(source, /reason instanceof AdminApiError && reason\.status === 409/u);
  assert.match(source, /aria-label="申诉处理时间线"/u);
  assert.match(source, /status === "INDEPENDENTLY_VERIFIED" && Boolean\(item\.proofVerifiedAt\)/u);
  assert.match(source, /线下退款凭证已核验/u);
  assert.match(source, /线下处理凭证（只读）/u);
  assert.doesNotMatch(source, /offline-refund-records|自动退款按钮|退款成功|已退款/u);
  assert.doesNotMatch(source, /ssh|canonicalSshPublicKey|buyerEmail/iu);
});
