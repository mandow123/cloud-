import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { bootstrapFirstAdministrator, constantTimeBootstrapCodeMatch, validatedAdminBootstrapCode } from "../lib/server/account-auth-bootstrap.ts";
import { AccountAuthError, createAccountSession, resolveAccountSession } from "../lib/server/account-auth.ts";
import { createD1AccountAuthStore } from "../lib/server/account-auth-d1.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";

const BOOTSTRAP_CODE = "q9Fx7mLp2Vz8Nc4Hw6Jt3Ry5Uk1Aa0Bd-q9Fx7mLp2Vz8Nc4H";
const NOW = new Date("2026-08-08T01:00:00.000Z");

function cookieHeader(cookie) { return cookie.split(";", 1)[0]; }
function authRequest(cookie) { return new Request("https://cloud.kai.com/api/auth/bootstrap-admin", { method: "POST", headers: { cookie: cookieHeader(cookie), origin: "https://cloud.kai.com", "content-type": "application/json" } }); }
function localAuthRequest(cookie) { return new Request("http://localhost/api/auth/bootstrap-admin", { method: "POST", headers: { cookie: cookieHeader(cookie), origin: "http://localhost", "content-type": "application/json" } }); }

async function identity(store, subject) {
  return store.resolveOrCreateIdentity({
    provider: "EMAIL", tenantKey: "EXTERNAL", subject, displayName: subject,
    normalizedEmail: `${subject}@example.test`, organizationExternalKey: `EMAIL:${subject}`,
    organizationName: `${subject} organization`, verifiedAt: NOW.toISOString(),
  });
}

async function formalSession(store, subject) {
  const resolved = await identity(store, subject);
  return createAccountSession(new Request("https://cloud.kai.com/api/auth/email/verify"), resolved, "EMAIL_OTP", { store, now: NOW });
}

class FakeD1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new FakeD1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() { return { meta: { changes: Number(this.database.prepare(this.sql).run(...this.values).changes) } }; }
}

class FakeD1Database {
  constructor() { this.database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true }); }
  prepare(sql) { return new FakeD1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  close() { this.database.close(); }
}

test("bootstrap code validation rejects missing, short, repeated, and placeholder values", () => {
  for (const value of [undefined, "short", "a".repeat(64), "replace-with-at-least-32-random-characters", "change-me-please-use-a-strong-random-value"]) {
    assert.throws(() => validatedAdminBootstrapCode(value), (error) => error instanceof AccountAuthError && error.code === "ADMIN_BOOTSTRAP_NOT_CONFIGURED");
  }
  assert.equal(validatedAdminBootstrapCode(BOOTSTRAP_CODE), BOOTSTRAP_CODE);
});

test("bootstrap code comparison accepts only the exact server value", async () => {
  assert.equal(await constantTimeBootstrapCodeMatch(BOOTSTRAP_CODE, BOOTSTRAP_CODE), true);
  assert.equal(await constantTimeBootstrapCodeMatch(BOOTSTRAP_CODE, `${BOOTSTRAP_CODE.slice(0, -1)}x`), false);
});

test("formal login can bootstrap once, rotates the session, and never audits the code", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-admin-bootstrap-"));
  const databasePath = join(directory, "auth.sqlite");
  const store = await createSqliteAccountAuthStore(databasePath);
  try {
    const initial = await formalSession(store, "first-admin");
    const rejectedCode = "this-wrong-code-must-never-appear-in-any-audit-record";
    await assert.rejects(
      bootstrapFirstAdministrator(authRequest(initial.cookie), rejectedCode, { store, env: { KAI_ADMIN_BOOTSTRAP_CODE: BOOTSTRAP_CODE }, now: NOW }),
      (error) => error instanceof AccountAuthError && error.code === "ADMIN_BOOTSTRAP_CODE_REJECTED",
    );
    const issued = await bootstrapFirstAdministrator(authRequest(initial.cookie), BOOTSTRAP_CODE, { store, env: { KAI_ADMIN_BOOTSTRAP_CODE: BOOTSTRAP_CODE }, now: NOW });
    assert.equal(issued.context.membership.status, "ACTIVE");
    assert.deepEqual(issued.context.membership.roles, ["ROLE_ADMIN"]);
    assert.equal(await resolveAccountSession(authRequest(initial.cookie), { store, now: NOW, touch: false }), null);
    assert.ok(await resolveAccountSession(authRequest(issued.cookie), { store, now: NOW, touch: false }));
    const db = new DatabaseSync(databasePath, { readOnly: true });
    const audit = db.prepare("SELECT event_type,metadata_json FROM admin_auth_audit_events ORDER BY occurred_at").all();
    db.close();
    assert.ok(audit.some((row) => row.event_type === "ADMIN_BOOTSTRAP_SUCCEEDED"));
    assert.ok(!JSON.stringify(audit).includes(BOOTSTRAP_CODE));
    assert.ok(!JSON.stringify(audit).includes(rejectedCode));
    await assert.rejects(
      bootstrapFirstAdministrator(authRequest(issued.cookie), "wrong", { store, env: {}, now: NOW }),
      (error) => error instanceof AccountAuthError && error.code === "ADMIN_BOOTSTRAP_CLOSED",
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a zero-admin installation fails closed when the server bootstrap value is missing", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  try {
    const initial = await formalSession(store, "missing-config");
    await assert.rejects(
      bootstrapFirstAdministrator(authRequest(initial.cookie), BOOTSTRAP_CODE, { store, env: {}, now: NOW }),
      (error) => error instanceof AccountAuthError && error.code === "ADMIN_BOOTSTRAP_NOT_CONFIGURED" && error.status === 503,
    );
    assert.equal(await store.isAdminBootstrapClosed(), false);
  } finally { store.close(); }
});

test("LOCAL_TEST sessions can never bootstrap an administrator", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  try {
    const resolved = await store.resolveOrCreateIdentity({ provider: "LOCAL", tenantKey: "LOCAL", subject: "local", displayName: "Local", normalizedEmail: null, organizationExternalKey: "LOCAL:KAI", organizationName: "Local", verifiedAt: NOW.toISOString() });
    const issued = await createAccountSession(new Request("http://localhost/api/auth/local"), resolved, "LOCAL_TEST", { store, now: NOW });
    await assert.rejects(
      bootstrapFirstAdministrator(localAuthRequest(issued.cookie), BOOTSTRAP_CODE, { store, env: { KAI_ADMIN_BOOTSTRAP_CODE: BOOTSTRAP_CODE }, now: NOW }),
      (error) => error instanceof AccountAuthError && error.code === "ADMIN_BOOTSTRAP_FORMAL_LOGIN_REQUIRED",
    );
  } finally { store.close(); }
});

async function concurrentBootstrapHarness(storeA, storeB) {
  const [first, second] = await Promise.all([formalSession(storeA, "candidate-a"), formalSession(storeB, "candidate-b")]);
  const attempts = await Promise.all([
    storeA.bootstrapAdminMembership({ membershipId: first.context.membership.id, accountId: first.context.account.id, organizationId: first.context.activeOrganization.id, sessionId: first.context.sessionId, claimedAt: NOW.toISOString() }),
    storeB.bootstrapAdminMembership({ membershipId: second.context.membership.id, accountId: second.context.account.id, organizationId: second.context.activeOrganization.id, sessionId: second.context.sessionId, claimedAt: new Date(NOW.getTime() + 1).toISOString() }),
  ]);
  assert.equal(attempts.filter(Boolean).length, 1);
  const memberships = [
    await storeA.getMembership(first.context.account.id, first.context.activeOrganization.id),
    await storeB.getMembership(second.context.account.id, second.context.activeOrganization.id),
  ];
  assert.equal(memberships.filter((item) => item?.status === "ACTIVE" && item.roles.includes("ROLE_ADMIN")).length, 1);
  assert.equal(await storeA.isAdminBootstrapClosed(), true);
}

test("two concurrent SQLite identities can establish at most one first administrator", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-admin-bootstrap-race-"));
  const databasePath = join(directory, "auth.sqlite");
  const storeA = await createSqliteAccountAuthStore(databasePath);
  const storeB = await createSqliteAccountAuthStore(databasePath);
  try { await concurrentBootstrapHarness(storeA, storeB); }
  finally { storeA.close(); storeB.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("two concurrent D1 identities can establish at most one first administrator", async () => {
  const d1 = new FakeD1Database();
  const storeA = await createD1AccountAuthStore(d1);
  const storeB = await createD1AccountAuthStore(d1);
  try { await concurrentBootstrapHarness(storeA, storeB); }
  finally { d1.close(); }
});
