import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { AccountAuthError, accountAuthDigest, createAccountSession, resolveAccountSession } from "../lib/server/account-auth.ts";
import { createAdminPasswordSession } from "../lib/server/admin-auth-password.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { createSqliteAdminOperationsStore } from "../lib/server/admin-store-sqlite.ts";
import { GET as accountSession } from "../app/api/auth/session/route.ts";
import { POST as passwordLogin } from "../app/api/auth/admin/password/route.ts";
import { POST as logout } from "../app/api/auth/logout/route.ts";
import { POST as switchOrganization } from "../app/api/auth/organization/route.ts";
import { GET as kaiHours } from "../app/api/v1/member/kai-hours/route.ts";
import { GET as requests } from "../app/api/requests/route.ts";
import { GET as quotes } from "../app/api/quotes/route.ts";
import { GET as drafts } from "../app/api/drafts/route.ts";
import { GET as csrfSession } from "../app/api/session/route.ts";

const SESSION_TABLES = ["admin_password_sessions", "kai_identity_oidc_sessions", "admin_account_sessions"];
const AUTH_METHODS = ["ADMIN_PASSWORD", "KAI_IDENTITY_OIDC", "EMAIL_OTP"];
const deniedMembership = error => error instanceof AccountAuthError && error.status === 403 && error.code === "ORGANIZATION_MEMBERSHIP_SUSPENDED";
const cookie = issued => issued.cookie.split(";", 1)[0];
const request = (path, sessionCookie, body) => new Request(`http://localhost${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { ...(sessionCookie ? { cookie: sessionCookie } : {}), ...(body === undefined ? {} : { origin: "http://localhost", "content-type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function fixture() {
  const directory = mkdtempSync(join(process.cwd(), ".membership-regression-"));
  const path = join(directory, "auth.sqlite");
  const auth = await createSqliteAccountAuthStore(path);
  const admin = await createSqliteAdminOperationsStore(path);
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  const now = new Date();
  const rootInput = { username: "membership-root", displayName: "Root", createdAt: now.toISOString() };
  const initialRoot = await auth.resolveOrCreatePasswordAdministrator(rootInput);
  await auth.activateMembership(initialRoot.membership.id, ["ROOT"], now.toISOString());
  const root = await auth.resolveOrCreatePasswordAdministrator(rootInput);
  const operatorInput = { username: "membership-operator", displayName: "Operator", createdAt: now.toISOString() };
  const initialOperator = await auth.resolveOrCreatePasswordAdministrator(operatorInput);
  await auth.activateMembership(initialOperator.membership.id, ["FULFILLMENT_OPERATOR"], now.toISOString());
  const operator = await auth.resolveOrCreatePasswordAdministrator(operatorInput);
  let command = 0;
  const setStatus = async (identity, status) => {
    const version = db.prepare("SELECT version FROM admin_principal_management WHERE membership_id=?").get(identity.membership.id)?.version ?? 0;
    return admin.updatePrincipalStatus(identity.account.id, {
      principalId: root.account.id, organizationId: identity.organization.id,
      idempotencyKey: `membership-status-${++command}`, payloadHash: `status-${command}-${status}`,
    }, { status, expectedVersion: version, reason: "Membership suspension regression verification" });
  };
  const issue = (identity, method = "EMAIL_OTP", store = auth) => createAccountSession(request("/api/auth/session"), identity, method, { store, now });
  return { auth, admin, db, now, root, operator, operatorInput, setStatus, issue, close() {
    db.close(); admin.close(); auth.close(); rmSync(directory, { recursive: true, force: true });
  } };
}

function useGlobals(auth, overrides = {}) {
  const values = { __kaiAccountAuthStorePromise: Promise.resolve(auth), ...overrides };
  const previous = new Map(Object.keys(values).map(key => [key, globalThis[key]]));
  Object.assign(globalThis, values);
  return () => { for (const [key, value] of previous) globalThis[key] = value; };
}

async function secondOrganization(f, account) {
  const id = `org_${(await accountAuthDigest(`second:${account.id}`)).slice(0, 40)}`;
  const membershipId = `mbr_${(await accountAuthDigest(`second-membership:${account.id}`)).slice(0, 40)}`;
  const at = f.now.toISOString();
  f.db.prepare("INSERT INTO admin_organizations(id,name,external_key,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)").run(id, "Second organization", `TEST:${account.id}`, at, at);
  f.db.prepare("INSERT INTO admin_memberships(id,account_id,organization_id,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)").run(membershipId, account.id, id, at, at);
  const membership = await f.auth.getMembership(account.id, id);
  return { account, organization: membership.organization, membership };
}

test("Pending sessions retain onboarding and organization switching while private API reads require Active membership", async () => {
  const f = await fixture();
  let restore;
  try {
    const pending = await f.auth.resolveOrCreateIdentity({ provider: "EMAIL", tenantKey: "EXTERNAL", subject: "pending-member", displayName: "Pending", normalizedEmail: "pending@example.test", organizationExternalKey: "EMAIL:pending-member", organizationName: "Pending organization", verifiedAt: f.now.toISOString() });
    const issued = await f.issue(pending);
    const other = await secondOrganization(f, pending.account);
    let privateReads = 0;
    const projection = { async getAccountProjection(organizationId) { privateReads++; return { organizationId }; } };
    const emptyPage = { items: [], hasMore: false, nextCursor: null };
    restore = useGlobals(f.auth, {
      __kaiStandardizationStorePromise: Promise.resolve(projection),
      __kaiMarketplaceStorePromise: Promise.resolve({
        async listPublicRequests() { return emptyPage; },
        async listOwnedRequests() { privateReads++; return emptyPage; },
        async listSupplierQuotes() { privateReads++; return emptyPage; },
        async listBuyerNormalizedQuotes() { privateReads++; return emptyPage; },
        async listOwnedDrafts() { privateReads++; return emptyPage; },
      }),
    });
    const session = await accountSession(request("/api/auth/session", cookie(issued)));
    assert.equal(session.status, 200);
    assert.equal((await session.json()).authenticated, true);
    for (const [route, path] of [[kaiHours, "/api/v1/member/kai-hours"], [requests, "/api/requests?view=mine"], [quotes, "/api/quotes"], [drafts, "/api/drafts"]]) {
      const response = await route(request(path, cookie(issued)));
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).error.code, "ORGANIZATION_MEMBERSHIP_INACTIVE");
    }
    assert.equal(privateReads, 0);
    assert.equal((await requests(request("/api/requests?view=market", cookie(issued)))).status, 200);
    assert.equal((await csrfSession(request("/api/session", cookie(issued)))).status, 200);
    const switched = await switchOrganization(request("/api/auth/organization", cookie(issued), { organizationId: other.organization.id }));
    assert.equal(switched.status, 200);
    const switchedCookie = switched.headers.get("set-cookie").split(";", 1)[0];
    const projectionResponse = await kaiHours(request("/api/v1/member/kai-hours", switchedCookie));
    assert.equal(projectionResponse.status, 200);
    assert.equal((await projectionResponse.json()).organizationId, other.organization.id);
    assert.equal(privateReads, 1);
    assert.equal((await accountSession(request("/api/auth/session", cookie(issued))).then(value => value.json())).authenticated, false);
    const pendingAgain = await f.issue(pending);
    assert.equal((await logout(request("/api/auth/logout", cookie(pendingAgain), {}))).status, 200);
  } finally { restore?.(); f.close(); }
});

test("legacy suspended sessions fail at resolution and issuance, but logout still clears them", async () => {
  const f = await fixture();
  const restore = useGlobals(f.auth);
  try {
    const sessions = await Promise.all(AUTH_METHODS.map(method => f.issue(f.operator, method)));
    f.db.prepare("UPDATE admin_memberships SET status='SUSPENDED' WHERE id=?").run(f.operator.membership.id);
    const suspended = await f.auth.resolveOrCreatePasswordAdministrator(f.operatorInput);
    for (const [index, session] of sessions.entries()) {
      await assert.rejects(resolveAccountSession(request("/api/auth/session", cookie(session)), { store: f.auth, now: f.now }), deniedMembership);
      await assert.rejects(f.issue(suspended, AUTH_METHODS[index]), deniedMembership);
      // The previously resolved Active identity must not bypass the INSERT guard.
      await assert.rejects(f.issue(f.operator, AUTH_METHODS[index]), deniedMembership);
      assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${SESSION_TABLES[index]} WHERE account_id=?`).get(f.operator.account.id).n, 1);
      const response = await logout(request("/api/auth/logout", cookie(session), {}));
      assert.equal(response.status, 200);
      assert.match(response.headers.get("set-cookie"), /Max-Age=0/u);
    }
    assert.equal(f.db.prepare("SELECT status FROM admin_memberships WHERE id=?").get(f.operator.membership.id).status, "SUSPENDED");
  } finally { restore(); f.close(); }
});

test("formal suspension atomically revokes all three session types for only the affected account and organization", async () => {
  const f = await fixture();
  try {
    const otherOrganization = await secondOrganization(f, f.operator.account);
    const affected = await Promise.all(AUTH_METHODS.map(method => f.issue(f.operator, method)));
    const unaffected = await Promise.all(AUTH_METHODS.map(method => f.issue(otherOrganization, method)));
    const rootSession = await f.issue(f.root, "ADMIN_PASSWORD");
    const result = await f.setStatus(f.operator, "SUSPENDED");
    assert.equal(result.record.status, "SUSPENDED");
    for (let index = 0; index < SESSION_TABLES.length; index++) {
      assert.ok(f.db.prepare(`SELECT revoked_at FROM ${SESSION_TABLES[index]} WHERE id=?`).get(affected[index].context.sessionId).revoked_at);
      assert.equal(f.db.prepare(`SELECT revoked_at FROM ${SESSION_TABLES[index]} WHERE id=?`).get(unaffected[index].context.sessionId).revoked_at, null);
      assert.equal(await resolveAccountSession(request("/api/auth/session", cookie(affected[index])), { store: f.auth }), null);
      assert.equal((await resolveAccountSession(request("/api/auth/session", cookie(unaffected[index])), { store: f.auth })).activeOrganization.id, otherOrganization.organization.id);
    }
    assert.ok(await resolveAccountSession(request("/api/auth/session", cookie(rootSession)), { store: f.auth }));
    const restored = await f.setStatus(f.operator, "ACTIVE");
    assert.equal(restored.record.status, "ACTIVE");
    assert.equal(await resolveAccountSession(request("/api/auth/session", cookie(affected[0])), { store: f.auth }), null, "restoration must never revive revoked cookies");
    assert.equal((await f.issue(await f.auth.resolveOrCreatePasswordAdministrator(f.operatorInput))).context.membership.status, "ACTIVE");
  } finally { f.close(); }
});

test("a failure during session revocation rolls back the entire suspension and its audit receipt", async () => {
  const f = await fixture();
  try {
    const sessions = await Promise.all(AUTH_METHODS.map(method => f.issue(f.operator, method)));
    f.db.exec("CREATE TRIGGER fail_membership_revoke BEFORE UPDATE OF revoked_at ON kai_identity_oidc_sessions BEGIN SELECT RAISE(ABORT,'injected revoke failure'); END");
    await assert.rejects(f.setStatus(f.operator, "SUSPENDED"), /injected revoke failure/u);
    assert.equal(f.db.prepare("SELECT status FROM admin_memberships WHERE id=?").get(f.operator.membership.id).status, "ACTIVE");
    for (const [index, session] of sessions.entries()) {
      assert.equal(f.db.prepare(`SELECT revoked_at FROM ${SESSION_TABLES[index]} WHERE id=?`).get(session.context.sessionId).revoked_at, null);
    }
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_principal_management WHERE membership_id=?").get(f.operator.membership.id).n, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_events WHERE action='ADMIN_PRINCIPAL_SUSPENDED'").get().n, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_command_receipts WHERE command_type LIKE 'UPDATE_ADMIN_PRINCIPAL_STATUS:%'").get().n, 0);
  } finally { f.close(); }
});

const testPassword = "Membership-only-test-password-01";
const salt = Buffer.from("membership-test-salt-01");
const passwordHash = `pbkdf2-sha256:310000:${salt.toString("base64")}:${pbkdf2Sync(testPassword, salt, 310000, 32, "sha256").toString("base64")}`;
const passwordEnvironment = { KAI_ADMIN_FULFILLMENT_USERNAME: "membership-operator", KAI_ADMIN_FULFILLMENT_PASSWORD_HASH: passwordHash };

test("password login cannot reactivate a suspended operator; formal restoration permits a new login", async () => {
  const f = await fixture();
  const restore = useGlobals(f.auth);
  const keys = ["KAI_PUBLIC_ORIGIN", "KAI_ADMIN_USERNAME", "KAI_ADMIN_APPROVER_USERNAME", ...Object.keys(passwordEnvironment)];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, passwordEnvironment);
    const login = () => passwordLogin(request("/api/auth/admin/password", null, { username: "membership-operator", password: testPassword }));
    assert.equal((await login()).status, 200);
    await f.setStatus(f.operator, "SUSPENDED");
    const denied = await login();
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, "ORGANIZATION_MEMBERSHIP_SUSPENDED");
    assert.equal(f.db.prepare("SELECT status FROM admin_memberships WHERE id=?").get(f.operator.membership.id).status, "SUSPENDED");
    assert.deepEqual((await f.auth.resolveOrCreatePasswordAdministrator(f.operatorInput)).membership.roles, ["FULFILLMENT_OPERATOR"]);
    await f.setStatus(f.operator, "ACTIVE");
    assert.equal((await login()).status, 200);
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    restore(); f.close();
  }
});

for (const boundary of ["activateMembership", "createSession"]) {
  test(`suspension wins a concurrent password login paused immediately before ${boundary}`, async () => {
    const f = await fixture();
    let unblock;
    try {
      let reached;
      const atBoundary = new Promise(resolve => { reached = resolve; });
      const resume = new Promise(resolve => { unblock = resolve; });
      const racingStore = new Proxy(f.auth, { get(target, property) {
        if (property !== boundary) return target[property];
        return async (...args) => { reached(); await resume; return target[property](...args); };
      } });
      const outcome = createAdminPasswordSession(request("/api/auth/admin/password"), { username: "membership-operator", password: testPassword }, { store: racingStore, env: passwordEnvironment })
        .then(value => ({ value }), error => ({ error }));
      await atBoundary;
      await f.setStatus(f.operator, "SUSPENDED");
      unblock();
      const result = await outcome;
      assert.ok(deniedMembership(result.error));
      assert.equal(f.db.prepare("SELECT status FROM admin_memberships WHERE id=?").get(f.operator.membership.id).status, "SUSPENDED");
      assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_password_sessions WHERE account_id=? AND revoked_at IS NULL").get(f.operator.account.id).n, 0);
      assert.deepEqual((await f.auth.resolveOrCreatePasswordAdministrator(f.operatorInput)).membership.roles, ["FULFILLMENT_OPERATOR"]);
    } finally { unblock?.(); f.close(); }
  });
}
