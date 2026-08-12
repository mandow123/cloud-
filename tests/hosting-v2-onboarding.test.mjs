import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { requireHostingV2Enabled } from "../lib/server/hosting-v2-feature.ts";
import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";

const account = {
  account: { id: "acct-hosting-supplier", displayName: "Hosting Supplier", primaryEmail: "supplier@example.com", status: "ACTIVE" },
  activeOrganization: { id: "org-hosting-supplier", name: "Hosting Supplier", externalKey: "HOSTING_SUPPLIER", status: "ACTIVE" },
  membership: { id: "mbr-hosting-supplier", accountId: "acct-hosting-supplier", organizationId: "org-hosting-supplier", status: "ACTIVE", roles: [] },
  sessionId: "session-hosting-supplier",
  authMethod: "KAI_IDENTITY_OIDC",
};

function mutation(actorId, key, hash, now) {
  return { actorId, idempotencyKey: key, payloadHash: hash, now };
}

test("supplier onboarding stays draft until an independent administrator approves it", async () => {
  const store = await createSqliteHostingV2Store(":memory:");
  try {
    assert.equal((await store.dashboard(account.activeOrganization.id, "2026-08-11T03:00:00Z")).profile, null);
    const saved = await store.saveProfile(account, { supplierType: "INDIVIDUAL", legalDisplayName: "个人 4090 供应方", contactEmail: "supplier@example.com", expectedVersion: 0 }, mutation(account.account.id, "profile-save-000001", "profile-save-hash", "2026-08-11T03:00:01Z"));
    assert.equal(saved.status, "DRAFT");
    assert.equal(saved.version, 1);
    assert.equal((await store.saveProfile(account, { supplierType: "INDIVIDUAL", legalDisplayName: "个人 4090 供应方", contactEmail: "supplier@example.com", expectedVersion: 0 }, mutation(account.account.id, "profile-save-000001", "profile-save-hash", "2026-08-11T03:00:01Z"))).version, 1);

    await assert.rejects(store.issueAgentChallenge(account, mutation(account.account.id, "challenge-before-review", "challenge-before-review-hash", "2026-08-11T03:00:02Z")), (error) => error.code === "EXCHANGE_ROLE_FORBIDDEN");
    await assert.rejects(store.submitProfile(account.activeOrganization.id, 2, process.env.KAI_HOSTING_TERMS_VERSION, mutation(account.account.id, "profile-submit-wrong", "profile-submit-wrong-hash", "2026-08-11T03:00:03Z")), (error) => error.code === "EXCHANGE_VERSION_CONFLICT");

    const submitted = await store.submitProfile(account.activeOrganization.id, 1, process.env.KAI_HOSTING_TERMS_VERSION, mutation(account.account.id, "profile-submit-000001", "profile-submit-hash", "2026-08-11T03:00:04Z"));
    assert.equal(submitted.status, "SUBMITTED");
    assert.equal(submitted.agreementVersion, process.env.KAI_HOSTING_TERMS_VERSION);
    await assert.rejects(store.reviewProfile(account.activeOrganization.id, { decision: "APPROVE", expectedVersion: 1, reviewNote: "材料完整，允许内部试运营" }, mutation("admin-reviewer", "profile-review-wrong", "profile-review-wrong-hash", "2026-08-11T03:00:05Z")), (error) => error.code === "EXCHANGE_VERSION_CONFLICT");

    const approved = await store.reviewProfile(account.activeOrganization.id, { decision: "APPROVE", expectedVersion: 2, reviewNote: "材料完整，允许内部试运营", evidenceDigest: "a".repeat(64) }, mutation("admin-reviewer", "profile-review-000001", "profile-review-hash", "2026-08-11T03:00:06Z"));
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.version, 3);
    assert.equal((await store.dashboard(account.activeOrganization.id, "2026-08-11T03:00:07Z")).readiness.supplierApproved, true);
    assert.match((await store.issueAgentChallenge(account, mutation(account.account.id, "challenge-after-review", "challenge-after-review-hash", "2026-08-11T03:00:08Z"))).id, /^hac_/u);
  } finally {
    store.close();
  }
});

test("supplier agreement snapshot comes from the configured immutable server policy", async () => {
  const store = await createSqliteHostingV2Store(":memory:");
  try {
    await store.saveProfile(account, { supplierType: "INDIVIDUAL", legalDisplayName: "协议版本测试供应方", contactEmail: "supplier@example.com", expectedVersion: 0 }, mutation(account.account.id, "terms-profile-save", "terms-profile-save-hash", "2026-08-11T03:10:01Z"));
    const submitted = await store.submitProfile(account.activeOrganization.id, 1, "KAI_HOSTING_TERMS_2026_09", mutation(account.account.id, "terms-profile-submit", "terms-profile-submit-hash", "2026-08-11T03:10:02Z"));
    assert.equal(submitted.agreementVersion, "KAI_HOSTING_TERMS_2026_09");
  } finally {
    store.close();
  }
});

test("hosting v2 APIs use formal sessions and never trust a workspace-role header", () => {
  const supplyRoutes = [
    "app/api/v2/supply/dashboard/route.ts",
    "app/api/v2/supply/profile/route.ts",
    "app/api/v2/supply/profile/submit/route.ts",
  ];
  for (const path of supplyRoutes) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /requireHostingV2Enabled\(\)/u);
    assert.match(source, /requireTradingAccountSession\(request\)/u);
    assert.doesNotMatch(source, /x-kai-workspace-role|authorizeSupplyWorkspaceRole/u);
  }
  const profileSource = readFileSync(supplyRoutes[1], "utf8");
  const profileWrite = profileSource.slice(profileSource.indexOf("export async function PUT"));
  const submitWrite = readFileSync(supplyRoutes[2], "utf8");
  assert.ok(profileWrite.indexOf("assertAccountAuthSameOrigin(request)") < profileWrite.indexOf("requireTradingAccountSession(request)"));
  assert.ok(submitWrite.indexOf("assertAccountAuthSameOrigin(request)") < submitWrite.indexOf("requireTradingAccountSession(request)"));
  assert.match(submitWrite, /const agreementVersion = hostingV2CurrentTermsVersion\(\)/u);
  assert.doesNotMatch(submitWrite, /KAI_HOSTING_2026_08/u);

  const adminList = readFileSync("app/api/v2/admin/supply/profiles/route.ts", "utf8");
  const adminReview = readFileSync("app/api/v2/admin/supply/profiles/[organizationId]/review/route.ts", "utf8");
  assert.match(adminList, /requireAdminPermission\(request, \["SUPPLY_INTAKE_READ"\]\)/u);
  assert.match(adminReview, /requireAdminPermission\(request, \["SUPPLY_INTAKE_REVIEW"\]\)/u);
  assert.ok(adminReview.indexOf("assertAccountAuthSameOrigin(request)") < adminReview.indexOf("requireAdminPermission(request"));
  assert.doesNotMatch(`${adminList}\n${adminReview}`, /x-kai-workspace-role/u);
});

test("hosting v2 feature switch fails closed", () => {
  const previous = process.env.KAI_HOSTING_V2;
  try {
    delete process.env.KAI_HOSTING_V2;
    assert.throws(requireHostingV2Enabled, (error) => error.code === "HOSTING_V2_DISABLED" && error.status === 503);
    process.env.KAI_HOSTING_V2 = "1";
    assert.doesNotThrow(requireHostingV2Enabled);
  } finally {
    if (previous === undefined) delete process.env.KAI_HOSTING_V2;
    else process.env.KAI_HOSTING_V2 = previous;
  }
});
