import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { auditKaiIdentityDatabase, auditKaiIdentityIssuers } from "../scripts/ops/audit-kai-identity-issuers.mjs";

function createFixture(path = ":memory:") {
  const database = new DatabaseSync(path);
  database.exec(`CREATE TABLE kai_identity_oidc_identities (
    id TEXT PRIMARY KEY,issuer TEXT NOT NULL,subject TEXT NOT NULL,account_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,verified_email TEXT NOT NULL,UNIQUE(issuer,subject))`);
  return database;
}

test("issuer audit aggregates conflicts without leaking identities or proposing email merges", () => {
  const database = createFixture();
  try {
    const insert = database.prepare("INSERT INTO kai_identity_oidc_identities VALUES(?,?,?,?,?,?)");
    insert.run("1", "https://auth.kai.com/api/auth", "sensitive-subject", "acct-old", "org-old", "private@example.test");
    insert.run("2", "https://auth.kai.com", "sensitive-subject", "acct-new", "org-new", "private@example.test");
    insert.run("3", "https://account.kai.com/connect", "legacy-subject", "acct-legacy", "org-legacy", "legacy@example.test");
    const result = auditKaiIdentityIssuers(database);
    assert.equal(result.status, "review-required");
    assert.deepEqual(result.issuerCounts, { legacy: 1, previousMisconfigured: 1, modern: 1, other: 0 });
    assert.equal(result.sameSubjectCrossIssuerPairs, 1);
    assert.equal(result.conflictingAccountOrOrganizationPairs, 1);
    assert.equal(result.emailOverlapAcrossIssuers, 1);
    assert.equal(result.migrationPerformed, false);
    assert.equal(result.automaticMergeAllowed, false);
    assert.doesNotMatch(JSON.stringify(result), /private@example|sensitive-subject|acct-old|org-new/u);
    assert.equal(database.prepare("SELECT issuer FROM kai_identity_oidc_identities WHERE id='1'").get().issuer, "https://auth.kai.com/api/auth");
  } finally { database.close(); }
});

test("issuer audit opens a snapshot read-only and leaves its files unchanged", () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-identity-audit-"));
  const path = join(directory, "snapshot.sqlite");
  const database = createFixture(path);
  database.close();
  const hash = () => createHash("sha256").update(readFileSync(path)).digest("hex");
  const before = hash();
  try {
    const result = auditKaiIdentityDatabase(path);
    assert.equal(result.status, "clear");
    assert.equal(result.identities, 0);
    assert.equal(hash(), before);
    assert.deepEqual(readdirSync(directory), ["snapshot.sqlite"]);
    assert.throws(() => auditKaiIdentityDatabase("relative.sqlite"), /OIDC_AUDIT_PATH_INVALID/u);
  } finally { rmSync(directory, { recursive: true }); }
});
