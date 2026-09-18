import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migrateKaiIdentityIssuerDatabase, parseKaiIdentityIssuerMapping } from "../scripts/ops/migrate-kai-identity-issuers.mjs";

const OLD = "https://auth.kai.com/api/auth";
const MODERN = "https://auth.kai.com";

function fixture(count = 10) {
  const directory = mkdtempSync(join(tmpdir(), "kai-identity-migration-"));
  const databasePath = join(directory, "cloud.sqlite");
  const mappingPath = join(directory, "mapping.json");
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE admin_user_accounts(id TEXT PRIMARY KEY,display_name TEXT NOT NULL,status TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE admin_organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE admin_memberships(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,organization_id TEXT NOT NULL,status TEXT NOT NULL,updated_at TEXT NOT NULL,
      FOREIGN KEY(account_id) REFERENCES admin_user_accounts(id),FOREIGN KEY(organization_id) REFERENCES admin_organizations(id));
    CREATE TABLE admin_membership_roles(membership_id TEXT NOT NULL,role TEXT NOT NULL,created_at TEXT NOT NULL,
      PRIMARY KEY(membership_id,role),FOREIGN KEY(membership_id) REFERENCES admin_memberships(id));
    CREATE TABLE kai_identity_oidc_identities(
      id TEXT PRIMARY KEY,account_id TEXT NOT NULL,organization_id TEXT NOT NULL,issuer TEXT NOT NULL,subject TEXT NOT NULL,
      verified_email TEXT NOT NULL,verified_at TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(issuer,subject),
      FOREIGN KEY(account_id) REFERENCES admin_user_accounts(id),FOREIGN KEY(organization_id) REFERENCES admin_organizations(id));`);
  const accounts = db.prepare("INSERT INTO admin_user_accounts VALUES(?,?,?,?)");
  const organizations = db.prepare("INSERT INTO admin_organizations VALUES(?,?,?,?)");
  const memberships = db.prepare("INSERT INTO admin_memberships VALUES(?,?,?,?,?)");
  const roles = db.prepare("INSERT INTO admin_membership_roles VALUES(?,?,?)");
  const identities = db.prepare("INSERT INTO kai_identity_oidc_identities VALUES(?,?,?,?,?,?,?,?)");
  const mappings = [];
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index).padStart(2, "0"), account = `account-${suffix}`, organization = `organization-${suffix}`;
    accounts.run(account, `Person ${suffix}`, "ACTIVE", "2026-01-02T03:04:05.000Z");
    organizations.run(organization, `Organization ${suffix}`, "ACTIVE", "2026-01-02T03:04:05.000Z");
    memberships.run(`membership-${suffix}`, account, organization, "ACTIVE", "2026-01-02T03:04:05.000Z");
    roles.run(`membership-${suffix}`, "BUYER", "2026-01-02T03:04:05.000Z");
    identities.run(`old-id-${suffix}`, account, organization, OLD, `old-sensitive-${suffix}`, `private-${suffix}@example.test`, "2026-01-02T03:04:05.000Z", "2025-01-02T03:04:05.000Z");
    mappings.push({ oldSubject: `old-sensitive-${suffix}`, newSubject: `new-sensitive-${suffix}` });
  }
  db.close();
  const mapping = { approvedBy: "KAI Identity operator", approvedAt: "2026-09-18T08:00:00.000Z", reference: "identity-console-export-20260918", mappings };
  writeFileSync(mappingPath, `${JSON.stringify(mapping)}\n`, { mode: 0o600 });
  chmodSync(mappingPath, 0o600);
  return { directory, databasePath, mappingPath, mapping };
}

function open(path) { return new DatabaseSync(path); }
function mappingHash(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function run(options) {
  return migrateKaiIdentityIssuerDatabase({
    ...options,
    ...(options.apply && options.approvedMappingSha256 === undefined ? { approvedMappingSha256: mappingHash(options.mappingPath) } : {}),
    requireRootOwner: false,
  });
}

test("dry-run validates a complete mapping without changing the database or leaking identity values", () => {
  const f = fixture(10), before = readFileSync(f.databasePath);
  try {
    const result = run({ databasePath: f.databasePath, mappingPath: f.mappingPath });
    assert.deepEqual({ status: result.status, mode: result.mode, old: result.oldIssuerCount, mapped: result.mappedCount, targets: result.existingTargetCount, inserts: result.insertCount },
      { status: "ready", mode: "dry-run", old: 10, mapped: 10, targets: 0, inserts: 10 });
    assert.match(result.mappingSha256, /^[a-f0-9]{64}$/u);
    assert.doesNotMatch(JSON.stringify(result), /sensitive|private|example/u);
    assert.deepEqual(readFileSync(f.databasePath), before);
  } finally { rmSync(f.directory, { recursive: true }); }
});

test("apply atomically adds ten mapped identities while retaining old identities and all metadata and IDs", () => {
  const f = fixture(10);
  try {
    const result = run({ databasePath: f.databasePath, mappingPath: f.mappingPath, apply: true, confirm: "APPLY_KAI_IDENTITY_ISSUER_MAPPING" });
    assert.equal(result.insertCount, 10);
    const db = open(f.databasePath);
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM kai_identity_oidc_identities WHERE issuer=?").get(OLD).n, 10);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM kai_identity_oidc_identities WHERE issuer=?").get(MODERN).n, 10);
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM kai_identity_oidc_identities old JOIN kai_identity_oidc_identities modern
        ON modern.account_id=old.account_id AND modern.organization_id=old.organization_id
        AND modern.verified_email=old.verified_email AND modern.verified_at=old.verified_at AND modern.created_at=old.created_at
        WHERE old.issuer=? AND modern.issuer=?`).get(OLD, MODERN).n, 10);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admin_user_accounts").get().n, 10);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admin_organizations").get().n, 10);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admin_memberships").get().n, 10);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.deepEqual(db.prepare("PRAGMA quick_check").all().map((row) => row.quick_check), ["ok"]);
    } finally { db.close(); }
  } finally { rmSync(f.directory, { recursive: true }); }
});

test("conflicting target rolls the whole migration back", () => {
  const f = fixture(3), db = open(f.databasePath);
  db.prepare("INSERT INTO kai_identity_oidc_identities VALUES(?,?,?,?,?,?,?,?)").run(
    "conflict", "account-01", "organization-01", MODERN, "new-sensitive-00", "other@example.test", "2026-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z");
  db.close();
  try {
    assert.throws(() => run({ databasePath: f.databasePath, mappingPath: f.mappingPath, apply: true, confirm: "APPLY_KAI_IDENTITY_ISSUER_MAPPING" }), /OIDC_MAPPING_TARGET_CONFLICT/u);
    const check = open(f.databasePath);
    try { assert.equal(check.prepare("SELECT COUNT(*) AS n FROM kai_identity_oidc_identities WHERE issuer=?").get(MODERN).n, 1); }
    finally { check.close(); }
  } finally { rmSync(f.directory, { recursive: true }); }
});

test("apply is bound to the independently reviewed mapping digest", () => {
  const f = fixture(2);
  try {
    const reviewed = run({ databasePath: f.databasePath, mappingPath: f.mappingPath });
    const changed = { ...f.mapping, mappings: [...f.mapping.mappings].reverse() };
    writeFileSync(f.mappingPath, `${JSON.stringify(changed)}\n`, { mode: 0o600 });
    assert.throws(() => run({
      databasePath: f.databasePath,
      mappingPath: f.mappingPath,
      apply: true,
      confirm: "APPLY_KAI_IDENTITY_ISSUER_MAPPING",
      approvedMappingSha256: reviewed.mappingSha256,
    }), /OIDC_MAPPING_APPROVAL_HASH_MISMATCH/u);
    const check = open(f.databasePath);
    try { assert.equal(check.prepare("SELECT COUNT(*) AS n FROM kai_identity_oidc_identities WHERE issuer=?").get(MODERN).n, 0); }
    finally { check.close(); }
  } finally { rmSync(f.directory, { recursive: true }); }
});

test("any account, organization, membership, or role mutation rolls the migration back", () => {
  const f = fixture(2), db = open(f.databasePath);
  db.exec(`CREATE TRIGGER mutate_membership_after_mapping AFTER INSERT ON kai_identity_oidc_identities
    WHEN NEW.issuer='${MODERN}' BEGIN
      UPDATE admin_memberships SET status='SUSPENDED' WHERE account_id=NEW.account_id;
    END`);
  db.close();
  try {
    assert.throws(() => run({ databasePath: f.databasePath, mappingPath: f.mappingPath, apply: true, confirm: "APPLY_KAI_IDENTITY_ISSUER_MAPPING" }), /OIDC_MIGRATION_INVARIANT_CHANGED/u);
    const check = open(f.databasePath);
    try {
      assert.equal(check.prepare("SELECT COUNT(*) AS n FROM admin_memberships WHERE status='SUSPENDED'").get().n, 0);
      assert.equal(check.prepare("SELECT COUNT(*) AS n FROM kai_identity_oidc_identities WHERE issuer=?").get(MODERN).n, 0);
    } finally { check.close(); }
  } finally { rmSync(f.directory, { recursive: true }); }
});

test("any mutation of a pre-existing identity row rolls the whole migration back", () => {
  const f = fixture(2), db = open(f.databasePath);
  db.exec(`CREATE TRIGGER mutate_old_identity_after_mapping AFTER INSERT ON kai_identity_oidc_identities
    WHEN NEW.issuer='${MODERN}' BEGIN
      UPDATE kai_identity_oidc_identities SET verified_email='rewritten@example.test'
      WHERE issuer='${OLD}' AND subject='old-sensitive-00';
    END`);
  db.close();
  try {
    assert.throws(() => run({ databasePath: f.databasePath, mappingPath: f.mappingPath, apply: true, confirm: "APPLY_KAI_IDENTITY_ISSUER_MAPPING" }), /OIDC_MIGRATION_INVARIANT_CHANGED/u);
    const check = open(f.databasePath);
    try {
      assert.equal(check.prepare("SELECT verified_email FROM kai_identity_oidc_identities WHERE issuer=? AND subject='old-sensitive-00'").get(OLD).verified_email, "private-00@example.test");
      assert.equal(check.prepare("SELECT COUNT(*) AS n FROM kai_identity_oidc_identities WHERE issuer=?").get(MODERN).n, 0);
    } finally { check.close(); }
  } finally { rmSync(f.directory, { recursive: true }); }
});

test("unplanned identities and mutations of planned modern rows roll the whole migration back", () => {
  for (const trigger of [
    `CREATE TRIGGER insert_unplanned_identity AFTER INSERT ON kai_identity_oidc_identities
      WHEN NEW.issuer='${MODERN}' AND NEW.subject='new-sensitive-00' BEGIN
        INSERT INTO kai_identity_oidc_identities VALUES('unexpected-id',NEW.account_id,NEW.organization_id,
          'https://unexpected.example','extra-sub','extra@example.test',NEW.verified_at,NEW.created_at);
      END`,
    `CREATE TRIGGER rewrite_planned_identity AFTER INSERT ON kai_identity_oidc_identities
      WHEN NEW.issuer='${MODERN}' BEGIN
        UPDATE kai_identity_oidc_identities SET verified_email='rewritten-modern@example.test' WHERE id=NEW.id;
      END`,
  ]) {
    const f = fixture(2), db = open(f.databasePath); db.exec(trigger); db.close();
    try {
      assert.throws(() => run({ databasePath: f.databasePath, mappingPath: f.mappingPath, apply: true, confirm: "APPLY_KAI_IDENTITY_ISSUER_MAPPING" }), /OIDC_MIGRATION_INVARIANT_CHANGED/u);
      const check = open(f.databasePath);
      try {
        assert.equal(check.prepare("SELECT COUNT(*) AS n FROM kai_identity_oidc_identities WHERE issuer<>?").get(OLD).n, 0);
        assert.equal(check.prepare("SELECT COUNT(*) AS n FROM kai_identity_oidc_identities WHERE issuer=?").get(MODERN).n, 0);
      } finally { check.close(); }
    } finally { rmSync(f.directory, { recursive: true }); }
  }
});

test("an identity ID collision and an insertion failure cannot leave a partial migration", () => {
  for (const inject of [
    (db) => {
      const id = `ident_${createHash("sha256").update(`${MODERN}:new-sensitive-01`).digest("hex").slice(0, 40)}`;
      db.prepare("INSERT INTO kai_identity_oidc_identities VALUES(?,?,?,?,?,?,?,?)").run(
        id, "account-00", "organization-00", "https://unrelated.example", "unrelated", "unrelated@example.test", "2026-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z");
      return /OIDC_MAPPING_ID_CONFLICT/u;
    },
    (db) => {
      db.exec(`CREATE TRIGGER reject_second_modern BEFORE INSERT ON kai_identity_oidc_identities
        WHEN NEW.issuer='${MODERN}' AND NEW.subject='new-sensitive-01'
        BEGIN SELECT RAISE(ABORT,'injected failure'); END`);
      return /OIDC_MIGRATION_FAILED/u;
    },
  ]) {
    const f = fixture(3), db = open(f.databasePath), expected = inject(db); db.close();
    try {
      assert.throws(() => run({ databasePath: f.databasePath, mappingPath: f.mappingPath, apply: true, confirm: "APPLY_KAI_IDENTITY_ISSUER_MAPPING" }), expected);
      const check = open(f.databasePath);
      try { assert.equal(check.prepare("SELECT COUNT(*) AS n FROM kai_identity_oidc_identities WHERE issuer=?").get(MODERN).n, 0); }
      finally { check.close(); }
    } finally { rmSync(f.directory, { recursive: true }); }
  }
});

test("mapping must cover every old row with no missing, extra, or duplicate subject", () => {
  for (const mutate of [
    (mapping) => mapping.mappings.pop(),
    (mapping) => mapping.mappings.push({ oldSubject: "not-in-database", newSubject: "extra-modern" }),
    (mapping) => { mapping.mappings[1].oldSubject = mapping.mappings[0].oldSubject; },
    (mapping) => { mapping.mappings[1].newSubject = mapping.mappings[0].newSubject; },
  ]) {
    const f = fixture(3);
    try {
      mutate(f.mapping); writeFileSync(f.mappingPath, JSON.stringify(f.mapping), { mode: 0o600 }); chmodSync(f.mappingPath, 0o600);
      assert.throws(() => run({ databasePath: f.databasePath, mappingPath: f.mappingPath }), /OIDC_MAPPING_(?:COVERAGE_INVALID|SUBJECT_DUPLICATE)/u);
    } finally { rmSync(f.directory, { recursive: true }); }
  }
});

test("repeated apply is idempotent", () => {
  const f = fixture(2);
  try {
    const options = { databasePath: f.databasePath, mappingPath: f.mappingPath, apply: true, confirm: "APPLY_KAI_IDENTITY_ISSUER_MAPPING" };
    assert.equal(run(options).insertCount, 2);
    const second = run(options);
    assert.equal(second.insertCount, 0);
    assert.equal(second.existingTargetCount, 2);
    const db = open(f.databasePath);
    try { assert.equal(db.prepare("SELECT COUNT(*) AS n FROM kai_identity_oidc_identities").get().n, 4); }
    finally { db.close(); }
  } finally { rmSync(f.directory, { recursive: true }); }
});

test("mapping schema, confirmation, permissions, symlinks, and relative paths fail closed", () => {
  const f = fixture(1);
  try {
    assert.throws(() => parseKaiIdentityIssuerMapping(JSON.stringify({ ...f.mapping, unexpected: true })), /OIDC_MAPPING_SCHEMA_INVALID/u);
    assert.equal(parseKaiIdentityIssuerMapping(JSON.stringify({ ...f.mapping, approvedAt: "2026-09-18T08:00:00.123Z" })).approvedAt, "2026-09-18T08:00:00.123Z");
    assert.throws(() => parseKaiIdentityIssuerMapping(JSON.stringify({ ...f.mapping, approvedAt: "2026-02-30T08:00:00.000Z" })), /OIDC_MAPPING_SCHEMA_INVALID/u);
    assert.throws(() => run({ databasePath: f.databasePath, mappingPath: f.mappingPath, apply: true }), /OIDC_MIGRATION_CONFIRMATION_REQUIRED/u);
    chmodSync(f.mappingPath, 0o644);
    assert.throws(() => run({ databasePath: f.databasePath, mappingPath: f.mappingPath }), /OIDC_MAPPING_FILE_UNPROTECTED/u);
    chmodSync(f.mappingPath, 0o600);
    const link = join(f.directory, "mapping-link.json"); symlinkSync(f.mappingPath, link);
    assert.throws(() => run({ databasePath: f.databasePath, mappingPath: link }), /OIDC_MAPPING_PATH_INVALID/u);
    assert.throws(() => run({ databasePath: "relative.sqlite", mappingPath: f.mappingPath }), /OIDC_MIGRATION_DATABASE_PATH_INVALID/u);
    assert.throws(() => migrateKaiIdentityIssuerDatabase({ databasePath: f.databasePath, mappingPath: f.mappingPath }), /OIDC_MAPPING_(?:DIRECTORY_UNPROTECTED|PATH_OUTSIDE_PROTECTED_ROOT|FILE_UNPROTECTED)/u);
  } finally { rmSync(f.directory, { recursive: true }); }
});
