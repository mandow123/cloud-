#!/usr/bin/env node

import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { KAI_IDENTITY_ISSUER, KAI_IDENTITY_MODERN_ISSUER, KAI_IDENTITY_MODERN_API_BASE } from "./kai-identity-provider-profile.mjs";

// Run against a verified SQLite snapshot or a protected read-only database mount.
// Counts are evidence for an operator review, never authorization to merge users.
export function auditKaiIdentityIssuers(database) {
  const required = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kai_identity_oidc_identities'").get();
  if (!required) throw new Error("OIDC_IDENTITY_SCHEMA_MISSING");
  const summary = database.prepare(`SELECT COUNT(*) AS identities,COUNT(DISTINCT account_id) AS accounts,
    COUNT(DISTINCT organization_id) AS organizations FROM kai_identity_oidc_identities`).get();
  const counts = database.prepare(`SELECT
    SUM(CASE WHEN issuer=? THEN 1 ELSE 0 END) AS legacy,
    SUM(CASE WHEN issuer=? THEN 1 ELSE 0 END) AS previousMisconfigured,
    SUM(CASE WHEN issuer=? THEN 1 ELSE 0 END) AS modern,
    SUM(CASE WHEN issuer NOT IN (?,?,?) THEN 1 ELSE 0 END) AS other
    FROM kai_identity_oidc_identities`).get(KAI_IDENTITY_ISSUER, KAI_IDENTITY_MODERN_API_BASE, KAI_IDENTITY_MODERN_ISSUER,
    KAI_IDENTITY_ISSUER, KAI_IDENTITY_MODERN_API_BASE, KAI_IDENTITY_MODERN_ISSUER);
  const crossIssuerSubjects = database.prepare(`SELECT COUNT(*) AS pairs,
    SUM(CASE WHEN old.account_id<>modern.account_id OR old.organization_id<>modern.organization_id THEN 1 ELSE 0 END) AS conflictingPairs
    FROM kai_identity_oidc_identities old JOIN kai_identity_oidc_identities modern
      ON old.subject=modern.subject AND modern.issuer=?
    WHERE old.issuer IN (?,?)`).get(KAI_IDENTITY_MODERN_ISSUER, KAI_IDENTITY_ISSUER, KAI_IDENTITY_MODERN_API_BASE);
  const emailOverlap = database.prepare(`SELECT COUNT(*) AS groups FROM (
    SELECT lower(trim(verified_email)) FROM kai_identity_oidc_identities
    WHERE trim(verified_email)<>'' GROUP BY lower(trim(verified_email)) HAVING COUNT(DISTINCT issuer)>1
  )`).get();
  const issuerCounts = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value ?? 0)]));
  const reviewRequired = issuerCounts.legacy > 0 || issuerCounts.previousMisconfigured > 0 || issuerCounts.other > 0;
  return Object.freeze({
    status: reviewRequired ? "review-required" : "clear",
    mode: "read-only",
    identities: Number(summary.identities), accounts: Number(summary.accounts), organizations: Number(summary.organizations),
    issuerCounts,
    sameSubjectCrossIssuerPairs: Number(crossIssuerSubjects.pairs),
    conflictingAccountOrOrganizationPairs: Number(crossIssuerSubjects.conflictingPairs ?? 0),
    emailOverlapAcrossIssuers: Number(emailOverlap.groups),
    migrationPerformed: false,
    automaticMergeAllowed: false,
    nextAction: reviewRequired ? "Require an independently verified issuer/subject mapping before any identity migration; email or matching subjects alone are insufficient." : "No historical issuer rows were found; this does not verify login or authorize a production change.",
  });
}

export function auditKaiIdentityDatabase(databasePath) {
  if (!isAbsolute(databasePath)) throw new Error("OIDC_AUDIT_PATH_INVALID");
  const metadata = lstatSync(databasePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || realpathSync(databasePath) !== resolve(databasePath)) throw new Error("OIDC_AUDIT_PATH_INVALID");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    // Keep all aggregate reads on one consistent view while production may write.
    database.exec("BEGIN");
    return auditKaiIdentityIssuers(database);
  } finally { database.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--db") throw new Error("OIDC_AUDIT_ARGUMENTS_INVALID");
    const result = auditKaiIdentityDatabase(process.argv[3]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== "clear") process.exitCode = 2;
  } catch (error) {
    const code = error instanceof Error && /^OIDC_[A-Z_]+$/u.test(error.message) ? error.message : "OIDC_AUDIT_FAILED";
    process.stderr.write(`${JSON.stringify({ status: "error", code, mode: "read-only", migrationPerformed: false })}\n`);
    process.exitCode = 1;
  }
}
