#!/usr/bin/env node

import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const OLD_ISSUER = "https://auth.kai.com/api/auth";
const NEW_ISSUER = "https://auth.kai.com";
const CONFIRMATION = "APPLY_KAI_IDENTITY_ISSUER_MAPPING";
const TABLE = "kai_identity_oidc_identities";

function fail(code) { throw new Error(code); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function validateRegularAbsolutePath(path, code) {
  if (typeof path !== "string" || !isAbsolute(path)) fail(code);
  let metadata;
  try { metadata = lstatSync(path); } catch { fail(code); }
  // The leaf itself must be a regular file. Ancestor aliases such as macOS's
  // /var -> /private/var are allowed; O_NOFOLLOW below protects the mapping leaf.
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(code);
  return metadata;
}

function protectedMappingFile(path, requireRootOwner) {
  validateRegularAbsolutePath(path, "OIDC_MAPPING_PATH_INVALID");
  const parent = lstatSync(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o022) !== 0
    || (requireRootOwner && (parent.uid !== 0 || parent.gid !== 0))) fail("OIDC_MAPPING_DIRECTORY_UNPROTECTED");
  if (requireRootOwner) {
    if (realpathSync(dirname(path)) !== resolve(dirname(path)) || realpathSync(path) !== resolve(path)
      || !resolve(path).startsWith("/root/kai-cloud-identity-mappings/")) fail("OIDC_MAPPING_PATH_OUTSIDE_PROTECTED_ROOT");
  }
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600 || (requireRootOwner && (metadata.uid !== 0 || metadata.gid !== 0))) {
      fail("OIDC_MAPPING_FILE_UNPROTECTED");
    }
    const contents = readFileSync(descriptor);
    return { contents, hash: sha256(contents) };
  } catch (error) {
    if (error instanceof Error && /^OIDC_[A-Z_]+$/u.test(error.message)) throw error;
    fail("OIDC_MAPPING_PATH_INVALID");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function approvedText(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
}

function subject(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 && !/[\u0000\r\n]/u.test(value);
}

export function parseKaiIdentityIssuerMapping(contents) {
  let parsed;
  try {
    const text = typeof contents === "string" ? contents : new TextDecoder("utf-8", { fatal: true }).decode(contents);
    parsed = JSON.parse(text);
  } catch { fail("OIDC_MAPPING_JSON_INVALID"); }
  if (!exactKeys(parsed, ["approvedBy", "approvedAt", "reference", "mappings"])) fail("OIDC_MAPPING_SCHEMA_INVALID");
  if (!approvedText(parsed.approvedBy, 256) || !approvedText(parsed.reference, 1024)) fail("OIDC_MAPPING_SCHEMA_INVALID");
  if (typeof parsed.approvedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(parsed.approvedAt)) {
    fail("OIDC_MAPPING_SCHEMA_INVALID");
  }
  const approvedInstant = new Date(parsed.approvedAt);
  const canonicalApprovedAt = parsed.approvedAt.length === 20 ? parsed.approvedAt.replace(/Z$/u, ".000Z") : parsed.approvedAt;
  if (!Number.isFinite(approvedInstant.getTime()) || approvedInstant.toISOString() !== canonicalApprovedAt) fail("OIDC_MAPPING_SCHEMA_INVALID");
  if (!Array.isArray(parsed.mappings)) fail("OIDC_MAPPING_SCHEMA_INVALID");
  const oldSubjects = new Set(), newSubjects = new Set();
  for (const mapping of parsed.mappings) {
    if (!exactKeys(mapping, ["oldSubject", "newSubject"]) || !subject(mapping.oldSubject) || !subject(mapping.newSubject)) {
      fail("OIDC_MAPPING_SCHEMA_INVALID");
    }
    if (oldSubjects.has(mapping.oldSubject) || newSubjects.has(mapping.newSubject)) fail("OIDC_MAPPING_SUBJECT_DUPLICATE");
    oldSubjects.add(mapping.oldSubject);
    newSubjects.add(mapping.newSubject);
  }
  return Object.freeze({
    approvedBy: parsed.approvedBy,
    approvedAt: parsed.approvedAt,
    reference: parsed.reference,
    mappings: Object.freeze(parsed.mappings.map((mapping) => Object.freeze({ ...mapping }))),
  });
}

function identityId(subjectValue) {
  return `ident_${sha256(`${NEW_ISSUER}:${subjectValue}`).slice(0, 40)}`;
}

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function canonicalRows(database, table, orderBy) {
  return database.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all()
    .map((row) => Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))));
}

function invariantSnapshot(database) {
  for (const table of ["admin_user_accounts", "admin_organizations", "admin_memberships", "admin_membership_roles", TABLE]) {
    if (!tableExists(database, table)) fail("OIDC_MIGRATION_SCHEMA_MISSING");
  }
  const protectedValues = {
    accounts: canonicalRows(database, "admin_user_accounts", "id"),
    organizations: canonicalRows(database, "admin_organizations", "id"),
    memberships: canonicalRows(database, "admin_memberships", "id"),
    membershipRoles: canonicalRows(database, "admin_membership_roles", "membership_id,role"),
  };
  const identities = canonicalRows(database, TABLE, "id");
  return Object.freeze({
    ...protectedValues,
    identities: Object.freeze(identities),
    protectedHash: sha256(JSON.stringify(protectedValues)),
    hash: sha256(JSON.stringify({ ...protectedValues, identities })),
  });
}

function expectedIdentityRows(before, entries) {
  const additions = entries.map((entry) => ({
    id: entry.id,
    account_id: entry.accountId,
    organization_id: entry.organizationId,
    issuer: NEW_ISSUER,
    subject: entry.subject,
    verified_email: entry.verifiedEmail,
    verified_at: entry.verifiedAt,
    created_at: entry.createdAt,
  })).map((row) => Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))));
  return [...before.identities, ...additions].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function quickCheck(database) {
  const rows = database.prepare("PRAGMA quick_check").all();
  if (rows.length !== 1 || rows[0].quick_check !== "ok") fail("OIDC_MIGRATION_QUICK_CHECK_FAILED");
  if (database.prepare("PRAGMA foreign_key_check").all().length !== 0) fail("OIDC_MIGRATION_FOREIGN_KEY_FAILED");
}

function planMigration(database, mapping) {
  const legacyRows = database.prepare(`SELECT id,subject,account_id,organization_id,verified_email,verified_at,created_at
    FROM ${TABLE} WHERE issuer=? ORDER BY subject`).all(OLD_ISSUER);
  const byOldSubject = new Map(mapping.mappings.map((entry) => [entry.oldSubject, entry]));
  if (legacyRows.length !== mapping.mappings.length || legacyRows.some((row) => !byOldSubject.has(String(row.subject)))) {
    fail("OIDC_MAPPING_COVERAGE_INVALID");
  }
  const entries = [];
  const plannedIds = new Set();
  let existing = 0;
  const readTarget = database.prepare(`SELECT id,account_id,organization_id,verified_email,verified_at,created_at
    FROM ${TABLE} WHERE issuer=? AND subject=?`);
  const readId = database.prepare(`SELECT issuer,subject,account_id,organization_id FROM ${TABLE} WHERE id=?`);
  for (const old of legacyRows) {
    const mapped = byOldSubject.get(String(old.subject));
    const id = identityId(mapped.newSubject);
    const target = readTarget.get(NEW_ISSUER, mapped.newSubject);
    if (target) {
      if (String(target.account_id) !== String(old.account_id) || String(target.organization_id) !== String(old.organization_id)) {
        fail("OIDC_MAPPING_TARGET_CONFLICT");
      }
      existing += 1;
      continue;
    }
    const idOwner = readId.get(id);
    if (idOwner || plannedIds.has(id)) fail("OIDC_MAPPING_ID_CONFLICT");
    plannedIds.add(id);
    entries.push(Object.freeze({
      id,
      accountId: String(old.account_id),
      organizationId: String(old.organization_id),
      subject: mapped.newSubject,
      verifiedEmail: String(old.verified_email),
      verifiedAt: String(old.verified_at),
      createdAt: String(old.created_at),
    }));
  }
  return Object.freeze({ legacyCount: legacyRows.length, existingCount: existing, entries: Object.freeze(entries) });
}

function result(mode, mappingHash, approvalHash, invariantHash, plan, insertedCount) {
  return Object.freeze({
    status: mode === "apply" ? "applied" : "ready",
    mode,
    oldIssuerCount: plan.legacyCount,
    mappedCount: plan.legacyCount,
    existingTargetCount: plan.existingCount,
    insertCount: mode === "apply" ? insertedCount : plan.entries.length,
    mappingSha256: mappingHash,
    approvalSha256: approvalHash,
    invariantSha256: invariantHash,
  });
}

export function migrateKaiIdentityIssuerDatabase({ databasePath, mappingPath, apply = false, confirm, approvedMappingSha256, requireRootOwner = true }) {
  validateRegularAbsolutePath(databasePath, "OIDC_MIGRATION_DATABASE_PATH_INVALID");
  if (apply && confirm !== CONFIRMATION) fail("OIDC_MIGRATION_CONFIRMATION_REQUIRED");
  if (!apply && confirm !== undefined) fail("OIDC_MIGRATION_ARGUMENTS_INVALID");
  const protectedFile = protectedMappingFile(mappingPath, requireRootOwner);
  if (apply && (!/^[a-f0-9]{64}$/u.test(approvedMappingSha256 ?? "") || approvedMappingSha256 !== protectedFile.hash)) {
    fail("OIDC_MAPPING_APPROVAL_HASH_MISMATCH");
  }
  if (!apply && approvedMappingSha256 !== undefined) fail("OIDC_MIGRATION_ARGUMENTS_INVALID");
  const mapping = parseKaiIdentityIssuerMapping(protectedFile.contents);
  const approvalHash = sha256(JSON.stringify({ approvedBy: mapping.approvedBy, approvedAt: mapping.approvedAt, reference: mapping.reference }));
  const database = new DatabaseSync(databasePath, { readOnly: !apply });
  let transaction = false;
  try {
    database.exec("PRAGMA foreign_keys=ON");
    database.exec(apply ? "BEGIN IMMEDIATE" : "BEGIN");
    transaction = true;
    quickCheck(database);
    const before = invariantSnapshot(database);
    const plan = planMigration(database, mapping);
    if (!apply) {
      database.exec("ROLLBACK");
      transaction = false;
      return result("dry-run", protectedFile.hash, approvalHash, before.hash, plan, 0);
    }
    const insert = database.prepare(`INSERT INTO ${TABLE}
      (id,account_id,organization_id,issuer,subject,verified_email,verified_at,created_at)
      VALUES(?,?,?,?,?,?,?,?)`);
    let inserted = 0;
    for (const entry of plan.entries) {
      const change = insert.run(entry.id, entry.accountId, entry.organizationId, NEW_ISSUER, entry.subject,
        entry.verifiedEmail, entry.verifiedAt, entry.createdAt);
      inserted += Number(change.changes);
    }
    quickCheck(database);
    const after = invariantSnapshot(database);
    if (after.protectedHash !== before.protectedHash
      || JSON.stringify(after.identities) !== JSON.stringify(expectedIdentityRows(before, plan.entries))) {
      fail("OIDC_MIGRATION_INVARIANT_CHANGED");
    }
    const afterPlan = planMigration(database, mapping);
    if (afterPlan.entries.length !== 0 || afterPlan.existingCount !== afterPlan.legacyCount) fail("OIDC_MIGRATION_POSTCONDITION_FAILED");
    database.exec("COMMIT");
    transaction = false;
    return result("apply", protectedFile.hash, approvalHash, before.hash, plan, inserted);
  } catch (error) {
    if (transaction) {
      try { database.exec("ROLLBACK"); } catch { /* preserve the original failure */ }
    }
    if (error instanceof Error && /^OIDC_[A-Z_]+$/u.test(error.message)) throw error;
    fail("OIDC_MIGRATION_FAILED");
  } finally { database.close(); }
}

function argumentsFrom(argv) {
  let databasePath, mappingPath, apply = false, confirm, approvedMappingSha256;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--db" && databasePath === undefined) databasePath = argv[++index];
    else if (option === "--mapping" && mappingPath === undefined) mappingPath = argv[++index];
    else if (option === "--apply" && !apply) apply = true;
    else if (option === "--confirm" && confirm === undefined) confirm = argv[++index];
    else if (option === "--approved-mapping-sha256" && approvedMappingSha256 === undefined) approvedMappingSha256 = argv[++index];
    else fail("OIDC_MIGRATION_ARGUMENTS_INVALID");
  }
  if (!databasePath || !mappingPath || (apply !== (confirm !== undefined)) || (apply !== (approvedMappingSha256 !== undefined))) fail("OIDC_MIGRATION_ARGUMENTS_INVALID");
  return { databasePath, mappingPath, apply, confirm, approvedMappingSha256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const output = migrateKaiIdentityIssuerDatabase(argumentsFrom(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    const code = error instanceof Error && /^OIDC_[A-Z_]+$/u.test(error.message) ? error.message : "OIDC_MIGRATION_FAILED";
    process.stderr.write(`${JSON.stringify({ status: "error", code })}\n`);
    process.exitCode = 1;
  }
}
