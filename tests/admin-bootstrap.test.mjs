import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import test from "node:test";

import { resolveAccountSession } from "../lib/server/account-auth.ts";
import { requireAdminPermission } from "../lib/server/admin-auth.ts";
import { createAdminPasswordSession } from "../lib/server/admin-auth-password.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";

const PASSWORD = "correct-horse-battery-staple-2026";
const SALT = Buffer.from("0123456789abcdef", "utf8");
const HASH = `pbkdf2-sha256:310000:${SALT.toString("base64")}:${pbkdf2Sync(PASSWORD, SALT, 310000, 32, "sha256").toString("base64")}`;
const ENV = { KAI_ADMIN_USERNAME: "kai-root", KAI_ADMIN_PASSWORD_HASH: HASH, KAI_ADMIN_DISPLAY_NAME: "KAI Root" };
const APPROVER_PASSWORD = "separate-finance-approval-password-2026";
const APPROVER_SALT = Buffer.from("fedcba9876543210", "utf8");
const APPROVER_HASH = `pbkdf2-sha256:310000:${APPROVER_SALT.toString("base64")}:${pbkdf2Sync(APPROVER_PASSWORD, APPROVER_SALT, 310000, 32, "sha256").toString("base64")}`;
const DUAL_CONTROL_ENV = { ...ENV, KAI_ADMIN_APPROVER_USERNAME: "kai-finance-approver", KAI_ADMIN_APPROVER_PASSWORD_HASH: APPROVER_HASH, KAI_ADMIN_APPROVER_DISPLAY_NAME: "KAI Finance Approver" };
const FULFILLMENT_PASSWORD = "separate-fulfillment-password-2026";
const FULFILLMENT_SALT = Buffer.from("delivery987654321", "utf8");
const FULFILLMENT_HASH = `pbkdf2-sha256:310000:${FULFILLMENT_SALT.toString("base64")}:${pbkdf2Sync(FULFILLMENT_PASSWORD, FULFILLMENT_SALT, 310000, 32, "sha256").toString("base64")}`;
const DELIVERY_ENV = { ...DUAL_CONTROL_ENV, KAI_ADMIN_FULFILLMENT_USERNAME: "kai-fulfillment", KAI_ADMIN_FULFILLMENT_PASSWORD_HASH: FULFILLMENT_HASH, KAI_ADMIN_FULFILLMENT_DISPLAY_NAME: "KAI Fulfillment" };

function request(cookie) {
  return new Request("https://cloud.kai.com/api/auth/admin/password", {
    method: "POST",
    headers: { origin: "https://cloud.kai.com", "user-agent": "admin-password-test", ...(cookie ? { cookie: cookie.split(";", 1)[0] } : {}) },
  });
}

test("administrator password creates the one Root and uses the existing secure session layer", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  try {
    const loginNow = new Date();
    const issued = await createAdminPasswordSession(request(), { username: "kai-root", password: PASSWORD }, { store, env: ENV, now: loginNow });
    assert.equal(issued.context.authMethod, "ADMIN_PASSWORD");
    assert.equal(issued.context.membership.status, "ACTIVE");
    assert.deepEqual(issued.context.membership.roles, ["ROOT"]);
    assert.match(issued.cookie, /HttpOnly/u);
    assert.match(issued.cookie, /SameSite=Strict/u);
    assert.match(issued.cookie, /Secure/u);
    const resolved = await resolveAccountSession(request(issued.cookie), { store, now: new Date(loginNow.getTime() + 60_000), touch: false });
    assert.equal(resolved?.account.displayName, "KAI Root");
    assert.equal(resolved?.authMethod, "ADMIN_PASSWORD");
    const previous = globalThis.__kaiAccountAuthStorePromise;
    globalThis.__kaiAccountAuthStorePromise = Promise.resolve(store);
    try {
      const admin = await requireAdminPermission(request(issued.cookie), ["ADMIN_PANEL_READ"]);
      assert.deepEqual(admin.principal.roles, ["ROOT"]);
    } finally {
      globalThis.__kaiAccountAuthStorePromise = previous;
    }
  } finally { store.close(); }
});

test("wrong password and unknown username return the same failure", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  try {
    for (const input of [{ username: "kai-root", password: `${PASSWORD}x` }, { username: "somebody", password: PASSWORD }]) {
      await assert.rejects(createAdminPasswordSession(request(), input, { store, env: ENV }), (error) => error.code === "ADMIN_PASSWORD_INVALID" && error.status === 401 && error.message === "账号或密码错误。 ");
    }
  } finally { store.close(); }
});

test("a separate password principal receives only the finance approval role", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  try {
    const root = await createAdminPasswordSession(request(), { username: "kai-root", password: PASSWORD }, { store, env: DUAL_CONTROL_ENV });
    const approver = await createAdminPasswordSession(request(), { username: "kai-finance-approver", password: APPROVER_PASSWORD }, { store, env: DUAL_CONTROL_ENV });
    assert.notEqual(root.context.account.id, approver.context.account.id);
    assert.deepEqual(root.context.membership.roles, ["ROOT"]);
    assert.deepEqual(approver.context.membership.roles, ["FINANCE_APPROVER"]);
    const previous = globalThis.__kaiAccountAuthStorePromise;
    globalThis.__kaiAccountAuthStorePromise = Promise.resolve(store);
    try {
      const finance = await requireAdminPermission(request(approver.cookie), ["PAYMENT_READ", "SETTLEMENT_OPERATE"]);
      assert.deepEqual(finance.principal.roles, ["FINANCE_APPROVER"]);
      await assert.rejects(requireAdminPermission(request(approver.cookie), ["MARKET_PUBLISH"]), (error) => error.code === "ADMIN_ACCESS_FORBIDDEN" && error.status === 403);
    } finally {
      globalThis.__kaiAccountAuthStorePromise = previous;
    }
  } finally { store.close(); }
});

test("a separate fulfillment password principal can operate delivery but cannot publish or settle", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  try {
    const issued = await createAdminPasswordSession(request(), { username: "kai-fulfillment", password: FULFILLMENT_PASSWORD }, { store, env: DELIVERY_ENV });
    assert.deepEqual(issued.context.membership.roles, ["FULFILLMENT_OPERATOR"]);
    const previous = globalThis.__kaiAccountAuthStorePromise;
    globalThis.__kaiAccountAuthStorePromise = Promise.resolve(store);
    try {
      const fulfillment = await requireAdminPermission(request(issued.cookie), ["FULFILLMENT_READ", "FULFILLMENT_OPERATE"]);
      assert.deepEqual(fulfillment.principal.roles, ["FULFILLMENT_OPERATOR"]);
      await assert.rejects(requireAdminPermission(request(issued.cookie), ["MARKET_PUBLISH"]), (error) => error.code === "ADMIN_ACCESS_FORBIDDEN" && error.status === 403);
      await assert.rejects(requireAdminPermission(request(issued.cookie), ["SETTLEMENT_OPERATE"]), (error) => error.code === "ADMIN_ACCESS_FORBIDDEN" && error.status === 403);
    } finally {
      globalThis.__kaiAccountAuthStorePromise = previous;
    }
  } finally { store.close(); }
});

test("password login is rate limited after five failures per account and client fingerprint", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  try {
    const now = new Date("2026-08-10T00:00:00Z");
    for (let index = 0; index < 5; index += 1) await assert.rejects(createAdminPasswordSession(request(), { username: "kai-root", password: `${PASSWORD}x` }, { store, env: ENV, now }));
    await assert.rejects(createAdminPasswordSession(request(), { username: "kai-root", password: PASSWORD }, { store, env: ENV, now }), (error) => error.code === "ADMIN_PASSWORD_RATE_LIMITED" && error.status === 429);
  } finally { store.close(); }
});
