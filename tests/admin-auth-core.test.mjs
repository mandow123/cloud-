import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN_PERMISSIONS, ADMIN_ROLES } from "../lib/admin-auth-types.ts";
import { adminPermissionsForRoles, requireAdminPermission } from "../lib/server/admin-auth.ts";
import { AccountAuthError, createAccountSession, resolveAccountSession } from "../lib/server/account-auth.ts";
import { accountSessionEnvelope, readAuthJson } from "../lib/server/account-auth-http.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { createLocalTestAccountSession } from "../lib/server/account-auth-local.ts";

test("only ROOT receives administrator permissions", () => {
  assert.deepEqual(ADMIN_ROLES, ["ROOT","ROLE_ADMIN","INTAKE_OPERATOR","INVENTORY_OPERATOR","VERIFICATION_REVIEWER","MARKET_OPERATOR","FULFILLMENT_OPERATOR","FINANCE_OPERATOR","FINANCE_APPROVER","SUPPORT_READONLY","AUDITOR"]);
  assert.deepEqual(adminPermissionsForRoles(["ROOT"]), ADMIN_PERMISSIONS);
  for (const role of ADMIN_ROLES.filter((candidate) => candidate !== "ROOT")) {
    assert.deepEqual(adminPermissionsForRoles([role]), [], `${role} must not receive admin permissions`);
  }
  assert.deepEqual(adminPermissionsForRoles(ADMIN_ROLES.filter((role) => role !== "ROOT")), []);
});

test("account sessions enforce a thirty-minute idle and eight-hour absolute limit", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  const now = new Date("2026-08-07T00:00:00.000Z");
  const identity = await store.resolveOrCreateIdentity({ provider:"LOCAL",tenantKey:"LOCAL",subject:"subject",displayName:"External",normalizedEmail:null,organizationExternalKey:"LOCAL:subject",organizationName:"External account",verifiedAt:now.toISOString() });
  await store.activateMembership(identity.membership.id,["SUPPORT_READONLY"],now.toISOString());
  const active = await store.resolveOrCreateIdentity({ provider:"LOCAL",tenantKey:"LOCAL",subject:"subject",displayName:"External",normalizedEmail:null,organizationExternalKey:"LOCAL:subject",organizationName:"External account",verifiedAt:now.toISOString() });
  const issued = await createAccountSession(new Request("http://localhost/api/auth/local"),active,"LOCAL_TEST",{store,now});
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

test("ordinary account sessions never expose an administrator principal", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  const now = new Date();
  const identity = await store.resolveOrCreateIdentity({ provider:"LOCAL",tenantKey:"LOCAL",subject:"ordinary",displayName:"Ordinary",normalizedEmail:null,organizationExternalKey:"LOCAL:ordinary",organizationName:"Ordinary Org",verifiedAt:now.toISOString() });
  await store.activateMembership(identity.membership.id,["SUPPORT_READONLY"],now.toISOString());
  const active = await store.resolveOrCreateIdentity({ provider:"LOCAL",tenantKey:"LOCAL",subject:"ordinary",displayName:"Ordinary",normalizedEmail:null,organizationExternalKey:"LOCAL:ordinary",organizationName:"Ordinary Org",verifiedAt:now.toISOString() });
  const issued = await createAccountSession(new Request("http://localhost/api/auth/local"),active,"LOCAL_TEST",{store,now});
  const envelope = await accountSessionEnvelope(issued.context, store);
  assert.equal(envelope.authenticated, true);
  assert.equal("admin" in envelope, false);
  store.close();
});

test("requireAdminPermission accepts ROOT and rejects every non-ROOT role", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  const now = new Date();
  const identity = await store.resolveOrCreatePasswordAdministrator({ username:"permission-test",displayName:"Permission Tester",createdAt:now.toISOString() });
  await store.activateMembership(identity.membership.id,["ROOT"],now.toISOString());
  const active = await store.resolveOrCreatePasswordAdministrator({ username:"permission-test",displayName:"Permission Tester",createdAt:now.toISOString() });
  const issued = await createAccountSession(new Request("http://localhost/api/auth/admin/password"),active,"ADMIN_PASSWORD",{store,now});
  const previous = globalThis.__kaiAccountAuthStorePromise;
  globalThis.__kaiAccountAuthStorePromise = Promise.resolve(store);
  try {
    const request = new Request("http://localhost/api/admin/inventory",{headers:{cookie:issued.cookie.split(";")[0]}});
    const context = await requireAdminPermission(request,["KAI_SELF_INVENTORY_WRITE", "REFUND_APPROVE"]);
    assert.equal(context.account.id,active.account.id);
    assert.equal(context.organization.id,active.organization.id);
    assert.equal(context.sessionId,issued.context.sessionId);
    assert.deepEqual(context.principal.roles,["ROOT"]);

    const other = await store.resolveOrCreateIdentity({ provider:"LOCAL",tenantKey:"LOCAL",subject:"non-root-test",displayName:"Non Root",normalizedEmail:null,organizationExternalKey:"LOCAL:NON_ROOT",organizationName:"Non Root Org",verifiedAt:now.toISOString() });
    await store.activateMembership(other.membership.id,["INVENTORY_OPERATOR"],now.toISOString());
    const activeOther = await store.resolveOrCreateIdentity({ provider:"LOCAL",tenantKey:"LOCAL",subject:"non-root-test",displayName:"Non Root",normalizedEmail:null,organizationExternalKey:"LOCAL:NON_ROOT",organizationName:"Non Root Org",verifiedAt:now.toISOString() });
    const otherIssued = await createAccountSession(new Request("http://localhost/api/auth/local"),activeOther,"LOCAL_TEST",{store,now});
    const otherRequest = new Request("http://localhost/api/admin/inventory",{headers:{cookie:otherIssued.cookie.split(";")[0]}});
    await assert.rejects(requireAdminPermission(otherRequest,["ADMIN_PANEL_READ"]),(error)=>error instanceof AccountAuthError&&error.status===403);
  } finally {
    globalThis.__kaiAccountAuthStorePromise = previous;
  }
});

test("authentication JSON rejects unsupported content and malformed payloads as client errors", async () => {
  await assert.rejects(readAuthJson(new Request("http://localhost/api/auth/admin/password",{method:"POST",body:"{}"})),(error)=>error instanceof AccountAuthError&&error.status===400&&error.code==="AUTH_JSON_REQUIRED");
  await assert.rejects(readAuthJson(new Request("http://localhost/api/auth/admin/password",{method:"POST",headers:{"content-type":"application/json"},body:"{"})),(error)=>error instanceof AccountAuthError&&error.status===400&&error.code==="AUTH_JSON_INVALID");
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
