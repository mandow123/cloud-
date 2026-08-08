import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN_PERMISSIONS, ADMIN_ROLES } from "../lib/admin-auth-types.ts";
import { adminPermissionsForRoles, requireAdminPermission } from "../lib/server/admin-auth.ts";
import { AccountAuthError, createAccountSession, resolveAccountSession } from "../lib/server/account-auth.ts";
import { readAuthJson } from "../lib/server/account-auth-http.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { createLocalTestAccountSession } from "../lib/server/account-auth-local.ts";

test("approved admin roles are exact and finance duties stay separated", () => {
  assert.deepEqual(ADMIN_ROLES, ["ROOT","ROLE_ADMIN","INTAKE_OPERATOR","INVENTORY_OPERATOR","VERIFICATION_REVIEWER","MARKET_OPERATOR","FULFILLMENT_OPERATOR","FINANCE_OPERATOR","FINANCE_APPROVER","SUPPORT_READONLY","AUDITOR"]);
  assert.deepEqual(adminPermissionsForRoles(["ROOT"]), ADMIN_PERMISSIONS);
  assert.ok(!adminPermissionsForRoles(["ROLE_ADMIN"]).includes("ROOT_CONTROL"));
  assert.ok(!adminPermissionsForRoles(ADMIN_ROLES.filter((role) => role !== "ROOT")).includes("ROOT_CONTROL"));
  assert.ok(adminPermissionsForRoles(["FINANCE_OPERATOR"]).includes("REFUND_REQUEST"));
  assert.ok(!adminPermissionsForRoles(["FINANCE_OPERATOR"]).includes("REFUND_APPROVE"));
  assert.ok(adminPermissionsForRoles(["FINANCE_APPROVER"]).includes("REFUND_APPROVE"));
});

test("account sessions enforce a thirty-minute idle and eight-hour absolute limit", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  const now = new Date("2026-08-07T00:00:00.000Z");
  const identity = await store.resolveOrCreateIdentity({ provider:"EMAIL",tenantKey:"EXTERNAL",subject:"subject",displayName:"External",normalizedEmail:"person@example.com",organizationExternalKey:"EMAIL:subject",organizationName:"External account",verifiedAt:now.toISOString() });
  await store.activateMembership(identity.membership.id,["SUPPORT_READONLY"],now.toISOString());
  const active = await store.resolveOrCreateIdentity({ provider:"EMAIL",tenantKey:"EXTERNAL",subject:"subject",displayName:"External",normalizedEmail:"person@example.com",organizationExternalKey:"EMAIL:subject",organizationName:"External account",verifiedAt:now.toISOString() });
  const issued = await createAccountSession(new Request("http://localhost/api/auth/local"),active,"EMAIL_OTP",{store,now});
  assert.equal(Date.parse(issued.absoluteExpiresAt)-now.getTime(),8*60*60*1_000);
  assert.equal(Date.parse(issued.idleExpiresAt)-now.getTime(),30*60*1_000);
  const cookie=issued.cookie.split(";")[0];
  assert.ok(await resolveAccountSession(new Request("http://localhost/api",{headers:{cookie}}),{store,now:new Date(now.getTime()+29*60_000)}));
  assert.equal(await resolveAccountSession(new Request("http://localhost/api",{headers:{cookie}}),{store,now:new Date(now.getTime()+8*60*60_000)}),null);
});

test("a client supplied ops header never creates an admin principal", async () => {
  await assert.rejects(
    requireAdminPermission(new Request("https://cloud.kai.com/api/admin",{headers:{"x-kai-workspace-role":"ops"}}),["ADMIN_PANEL_READ"]),
    (error)=>error instanceof AccountAuthError&&error.status===401,
  );
});

test("requireAdminPermission returns the pinned active account context and denies missing permissions", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  const now = new Date();
  const identity = await store.resolveOrCreateIdentity({ provider:"LOCAL",tenantKey:"LOCAL",subject:"permission-test",displayName:"Permission Tester",normalizedEmail:null,organizationExternalKey:"LOCAL:PERMISSION",organizationName:"Permission Org",verifiedAt:now.toISOString() });
  await store.activateMembership(identity.membership.id,["INVENTORY_OPERATOR"],now.toISOString());
  const active = await store.resolveOrCreateIdentity({ provider:"LOCAL",tenantKey:"LOCAL",subject:"permission-test",displayName:"Permission Tester",normalizedEmail:null,organizationExternalKey:"LOCAL:PERMISSION",organizationName:"Permission Org",verifiedAt:now.toISOString() });
  const issued = await createAccountSession(new Request("http://localhost/api/auth/local"),active,"LOCAL_TEST",{store,now});
  const previous = globalThis.__kaiAccountAuthStorePromise;
  globalThis.__kaiAccountAuthStorePromise = Promise.resolve(store);
  try {
    const request = new Request("http://localhost/api/admin/inventory",{headers:{cookie:issued.cookie.split(";")[0]}});
    const context = await requireAdminPermission(request,["KAI_SELF_INVENTORY_WRITE"]);
    assert.equal(context.account.id,active.account.id);
    assert.equal(context.organization.id,active.organization.id);
    assert.equal(context.sessionId,issued.context.sessionId);
    assert.deepEqual(context.principal.roles,["INVENTORY_OPERATOR"]);
    await assert.rejects(requireAdminPermission(request,["REFUND_APPROVE"]),(error)=>error instanceof AccountAuthError&&error.status===403);
  } finally {
    globalThis.__kaiAccountAuthStorePromise = previous;
  }
});

test("authentication JSON rejects unsupported content and malformed payloads as client errors", async () => {
  await assert.rejects(readAuthJson(new Request("http://localhost/api/auth/email/request",{method:"POST",body:"{}"})),(error)=>error instanceof AccountAuthError&&error.status===400&&error.code==="AUTH_JSON_REQUIRED");
  await assert.rejects(readAuthJson(new Request("http://localhost/api/auth/email/request",{method:"POST",headers:{"content-type":"application/json"},body:"{"})),(error)=>error instanceof AccountAuthError&&error.status===400&&error.code==="AUTH_JSON_INVALID");
});

test("LOCAL login is limited to same-origin localhost and roles come only from server config", async () => {
  const store=await createSqliteAccountAuthStore(":memory:");
  const env={NODE_ENV:"development",KAI_ADMIN_LOCAL_AUTH:"1",KAI_ADMIN_LOCAL_ROLES:"INVENTORY_OPERATOR"};
  const request=new Request("http://localhost/api/auth/local",{method:"POST",headers:{origin:"http://localhost","sec-fetch-site":"same-origin"}});
  const issued=await createLocalTestAccountSession(request,{store,env,now:new Date("2026-08-07T00:00:00Z")});
  assert.deepEqual(issued.context.membership.roles,["INVENTORY_OPERATOR"]);
  await assert.rejects(createLocalTestAccountSession(request,{store,env:{...env,NODE_ENV:"production"}}),(error)=>error instanceof AccountAuthError&&error.status===403);
  await assert.rejects(createLocalTestAccountSession(new Request("http://evil.test/api/auth/local",{method:"POST",headers:{origin:"http://evil.test","sec-fetch-site":"same-origin"}}),{store,env}),(error)=>error instanceof AccountAuthError&&error.status===403);
});

test("LOCAL preview can establish exactly one immutable Root account", async () => {
  const store=await createSqliteAccountAuthStore(":memory:");
  const request=new Request("http://localhost/api/auth/local",{method:"POST",headers:{origin:"http://localhost","sec-fetch-site":"same-origin"}});
  const env={NODE_ENV:"development",KAI_ADMIN_LOCAL_AUTH:"1",KAI_ADMIN_LOCAL_ROLES:"ROOT",KAI_ADMIN_LOCAL_SUBJECT:"root-one"};
  const issued=await createLocalTestAccountSession(request,{store,env,now:new Date("2026-08-08T00:00:00Z")});
  assert.deepEqual(issued.context.membership.roles,["ROOT"]);
  assert.deepEqual(adminPermissionsForRoles(issued.context.membership.roles),ADMIN_PERMISSIONS);
  await assert.rejects(createLocalTestAccountSession(request,{store,env:{...env,KAI_ADMIN_LOCAL_SUBJECT:"root-two"},now:new Date("2026-08-08T00:01:00Z")}));
  store.close();
});
