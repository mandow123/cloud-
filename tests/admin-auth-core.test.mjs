import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN_PERMISSIONS, ADMIN_ROLES } from "../lib/admin-auth-types.ts";
import { adminPermissionsForRoles, requireAdminPermission } from "../lib/server/admin-auth.ts";
import { AccountAuthError, assertAccountAuthSameOrigin, createAccountSession, resolveAccountSession } from "../lib/server/account-auth.ts";
import { accountSessionEnvelope, readAuthJson } from "../lib/server/account-auth-http.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { createLocalTestAccountSession } from "../lib/server/account-auth-local.ts";
import { isAllowedLocalQaOrigin } from "../lib/server/local-qa-origin.ts";

test("Root owns full administration while the independent finance approver receives only dual-control permissions", () => {
  assert.deepEqual(ADMIN_ROLES, ["ROOT","ROLE_ADMIN","INTAKE_OPERATOR","INVENTORY_OPERATOR","VERIFICATION_REVIEWER","MARKET_OPERATOR","FULFILLMENT_OPERATOR","FINANCE_OPERATOR","FINANCE_APPROVER","SUPPORT_READONLY","AUDITOR"]);
  assert.deepEqual(adminPermissionsForRoles(["ROOT"]), ADMIN_PERMISSIONS);
  assert.deepEqual(adminPermissionsForRoles(["FINANCE_APPROVER"]), ["ADMIN_PANEL_READ", "PAYMENT_READ", "SETTLEMENT_OPERATE", "AUDIT_READ"]);
  for (const role of ADMIN_ROLES.filter((candidate) => !["ROOT", "FINANCE_APPROVER"].includes(candidate))) {
    assert.deepEqual(adminPermissionsForRoles([role]), [], `${role} must not receive admin permissions`);
  }
  assert.deepEqual(adminPermissionsForRoles(ADMIN_ROLES.filter((role) => role !== "ROOT")), ["ADMIN_PANEL_READ", "PAYMENT_READ", "SETTLEMENT_OPERATE", "AUDIT_READ"]);
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

test("ordinary account sessions never expose an administrator principal", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  const now = new Date();
  const identity = await store.resolveOrCreateIdentity({ provider:"EMAIL",tenantKey:"EXTERNAL",subject:"ordinary",displayName:"Ordinary",normalizedEmail:"ordinary@example.com",organizationExternalKey:"EMAIL:ordinary",organizationName:"Ordinary Org",verifiedAt:now.toISOString() });
  await store.activateMembership(identity.membership.id,["SUPPORT_READONLY"],now.toISOString());
  const active = await store.resolveOrCreateIdentity({ provider:"EMAIL",tenantKey:"EXTERNAL",subject:"ordinary",displayName:"Ordinary",normalizedEmail:"ordinary@example.com",organizationExternalKey:"EMAIL:ordinary",organizationName:"Ordinary Org",verifiedAt:now.toISOString() });
  const issued = await createAccountSession(new Request("http://localhost/api/auth/email/verify"),active,"EMAIL_OTP",{store,now});
  const envelope = await accountSessionEnvelope(issued.context, store);
  assert.equal(envelope.authenticated, true);
  assert.equal("admin" in envelope, false);
  store.close();
});

test("requireAdminPermission accepts Root and limits the password finance approver to its explicit scope", async () => {
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
    const otherIssued = await createAccountSession(new Request("http://localhost/api/auth/email/verify"),activeOther,"EMAIL_OTP",{store,now});
    const otherRequest = new Request("http://localhost/api/admin/inventory",{headers:{cookie:otherIssued.cookie.split(";")[0]}});
    await assert.rejects(requireAdminPermission(otherRequest,["ADMIN_PANEL_READ"]),(error)=>error instanceof AccountAuthError&&error.status===403);

    const approver = await store.resolveOrCreatePasswordAdministrator({ username:"finance-approver-test",displayName:"Finance Approver",createdAt:now.toISOString() });
    await store.activateMembership(approver.membership.id,["FINANCE_APPROVER"],now.toISOString());
    const activeApprover = await store.resolveOrCreatePasswordAdministrator({ username:"finance-approver-test",displayName:"Finance Approver",createdAt:now.toISOString() });
    const approverIssued = await createAccountSession(new Request("http://localhost/api/auth/admin/password"),activeApprover,"ADMIN_PASSWORD",{store,now});
    const approverRequest = new Request("http://localhost/api/admin/card-hours",{headers:{cookie:approverIssued.cookie.split(";")[0]}});
    const approverContext = await requireAdminPermission(approverRequest,["PAYMENT_READ", "SETTLEMENT_OPERATE"]);
    assert.deepEqual(approverContext.principal.roles,["FINANCE_APPROVER"]);
    await assert.rejects(requireAdminPermission(approverRequest,["SUPPLY_INTAKE_REVIEW"]),(error)=>error instanceof AccountAuthError&&error.status===403);
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

test("LOCAL preview can isolate supplier and buyer organizations using server-only config", async () => {
  const store=await createSqliteAccountAuthStore(":memory:");
  try {
    const request=new Request("http://localhost/api/auth/local",{method:"POST",headers:{origin:"http://localhost","sec-fetch-site":"same-origin"}});
    const base={NODE_ENV:"development",KAI_ADMIN_LOCAL_AUTH:"1",KAI_ADMIN_LOCAL_ROLES:"SUPPORT_READONLY"};
    const supplier=await createLocalTestAccountSession(request,{store,env:{...base,KAI_ADMIN_LOCAL_SUBJECT:"supplier",KAI_ADMIN_LOCAL_ORGANIZATION_KEY:"LOCAL:SUPPLIER",KAI_ADMIN_LOCAL_ORGANIZATION_NAME:"Local Supplier"}});
    const buyer=await createLocalTestAccountSession(request,{store,env:{...base,KAI_ADMIN_LOCAL_SUBJECT:"buyer",KAI_ADMIN_LOCAL_ORGANIZATION_KEY:"LOCAL:BUYER",KAI_ADMIN_LOCAL_ORGANIZATION_NAME:"Local Buyer"}});
    assert.notEqual(supplier.context.account.id,buyer.context.account.id);
    assert.notEqual(supplier.context.activeOrganization.id,buyer.context.activeOrganization.id);
    assert.equal(supplier.context.activeOrganization.externalKey,"LOCAL:SUPPLIER");
    assert.equal(buyer.context.activeOrganization.externalKey,"LOCAL:BUYER");
  } finally { store.close(); }
});

test("LOCAL preview can establish exactly one immutable Root account", async () => {
  const store=await createSqliteAccountAuthStore(":memory:");
  const request=new Request("http://localhost/api/auth/local",{method:"POST",headers:{origin:"http://localhost","sec-fetch-site":"same-origin"}});
  const env={NODE_ENV:"development",KAI_ADMIN_LOCAL_AUTH:"1",KAI_ADMIN_LOCAL_ROLES:"ROOT",KAI_ADMIN_LOCAL_SUBJECT:"root-one"};
  const now=new Date();
  const issued=await createLocalTestAccountSession(request,{store,env,now});
  assert.deepEqual(issued.context.membership.roles,["ROOT"]);
  assert.equal(issued.context.authMethod,"ADMIN_PASSWORD");
  assert.deepEqual(adminPermissionsForRoles(issued.context.membership.roles),ADMIN_PERMISSIONS);
  const previous=globalThis.__kaiAccountAuthStorePromise;
  globalThis.__kaiAccountAuthStorePromise=Promise.resolve(store);
  try {
    const admin=await requireAdminPermission(new Request("http://localhost/api/admin/hosting",{headers:{cookie:issued.cookie.split(";")[0]}}),["SUPPLY_INTAKE_REVIEW"]);
    assert.deepEqual(admin.principal.roles,["ROOT"]);
  } finally { globalThis.__kaiAccountAuthStorePromise=previous; }
  await assert.rejects(createLocalTestAccountSession(request,{store,env:{...env,KAI_ADMIN_LOCAL_SUBJECT:"root-two"},now:new Date(now.getTime()+60_000)}));
  store.close();
});

test("LOCAL supplier preview remains a non-administrator account session", async () => {
  const store=await createSqliteAccountAuthStore(":memory:");
  const request=new Request("http://localhost/api/auth/local",{method:"POST",headers:{origin:"http://localhost","sec-fetch-site":"same-origin"}});
  const issued=await createLocalTestAccountSession(request,{store,env:{NODE_ENV:"development",KAI_ADMIN_LOCAL_AUTH:"1",KAI_ADMIN_LOCAL_ROLES:"SUPPORT_READONLY",KAI_ADMIN_LOCAL_SUBJECT:"supplier"}});
  assert.equal(issued.context.authMethod,"LOCAL_TEST");
  const previous=globalThis.__kaiAccountAuthStorePromise;
  globalThis.__kaiAccountAuthStorePromise=Promise.resolve(store);
  try {
    await assert.rejects(requireAdminPermission(new Request("http://localhost/api/admin/hosting",{headers:{cookie:issued.cookie.split(";")[0]}}),["SUPPLY_INTAKE_REVIEW"]),(error)=>error instanceof AccountAuthError&&error.status===403);
  } finally { globalThis.__kaiAccountAuthStorePromise=previous; }
  store.close();
});

test("LOCAL multi-role QA uses host-only identities while production rejects the mode", async () => {
  const store=await createSqliteAccountAuthStore(":memory:");
  const env={NODE_ENV:"development",KAI_ADMIN_LOCAL_AUTH:"1",KAI_ADMIN_LOCAL_MULTI_ROLE_QA:"1"};
  const login=async(host)=>createLocalTestAccountSession(new Request(`http://${host}/api/auth/local`,{method:"POST",headers:{origin:`http://${host}`,"sec-fetch-site":"same-origin"}}),{store,env});
  const buyer=await login("buyer.localhost");
  const supplier=await login("supplier.localhost");
  const finance=await login("finance.localhost");
  assert.equal(buyer.context.activeOrganization.externalKey,"LOCAL:BUYER");
  assert.equal(supplier.context.activeOrganization.externalKey,"LOCAL:SUPPLIER");
  assert.equal(finance.context.authMethod,"ADMIN_PASSWORD");
  assert.deepEqual(finance.context.membership.roles,["FINANCE_APPROVER"]);
  await assert.rejects(createLocalTestAccountSession(new Request("http://buyer.localhost/api/auth/local",{method:"POST",headers:{origin:"http://buyer.localhost","sec-fetch-site":"same-origin"}}),{store,env:{...env,NODE_ENV:"production"}}),(error)=>error instanceof AccountAuthError&&error.status===403);
  store.close();
});

test("LOCAL Root alias reuses the configured singleton password administrator", async () => {
  const store=await createSqliteAccountAuthStore(":memory:");
  const env={NODE_ENV:"development",KAI_ADMIN_LOCAL_AUTH:"1",KAI_ADMIN_LOCAL_MULTI_ROLE_QA:"1",KAI_ADMIN_USERNAME:"configured-root",KAI_ADMIN_DISPLAY_NAME:"Configured Root"};
  const request=new Request("http://root.localhost/api/auth/local",{method:"POST",headers:{origin:"http://root.localhost","sec-fetch-site":"same-origin"}});
  const first=await createLocalTestAccountSession(request,{store,env});
  const second=await createLocalTestAccountSession(request,{store,env});
  assert.equal(first.context.account.id,second.context.account.id);
  assert.equal(first.context.activeOrganization.externalKey,"KAI:CLOUD:ROOT");
  assert.deepEqual(first.context.membership.roles,["ROOT"]);
  const other=await store.resolveOrCreatePasswordAdministrator({username:"other-root",displayName:"Other",createdAt:new Date().toISOString()});
  await assert.rejects(store.activateMembership(other.membership.id,["ROOT"],new Date().toISOString()));
  store.close();
});

test("LOCAL Root alias reuses a singleton previously established by localhost preview", async () => {
  const store=await createSqliteAccountAuthStore(":memory:");
  const ordinaryRequest=new Request("http://localhost/api/auth/local",{method:"POST",headers:{origin:"http://localhost","sec-fetch-site":"same-origin"}});
  const established=await createLocalTestAccountSession(ordinaryRequest,{store,env:{NODE_ENV:"development",KAI_ADMIN_LOCAL_AUTH:"1",KAI_ADMIN_LOCAL_ROLES:"ROOT",KAI_ADMIN_LOCAL_SUBJECT:"existing-local-root"}});
  const aliasRequest=new Request("http://root.localhost/api/auth/local",{method:"POST",headers:{origin:"http://root.localhost","sec-fetch-site":"same-origin"}});
  const alias=await createLocalTestAccountSession(aliasRequest,{store,env:{NODE_ENV:"development",KAI_ADMIN_LOCAL_AUTH:"1",KAI_ADMIN_LOCAL_MULTI_ROLE_QA:"1",KAI_ADMIN_USERNAME:"configured-root"}});
  assert.equal(alias.context.account.id,established.context.account.id);
  assert.equal(alias.context.activeOrganization.id,established.context.activeOrganization.id);
  assert.deepEqual(alias.context.membership.roles,["ROOT"]);
  assert.equal(alias.context.authMethod,"ADMIN_PASSWORD");
  store.close();
});

test("LOCAL multi-role origins are exact and can never weaken production origin checks", () => {
  const environment = { NODE_ENV: "development", KAI_ADMIN_LOCAL_AUTH: "1", KAI_ADMIN_LOCAL_MULTI_ROLE_QA: "1" };
  const supplierRequest = new Request("http://supplier.localhost:3014/api/v2/supply/profile", { headers: { origin: "http://supplier.localhost:3014", "sec-fetch-site": "same-origin" } });
  assert.equal(isAllowedLocalQaOrigin(supplierRequest, new URL("http://supplier.localhost:3014"), environment), true);
  assert.equal(isAllowedLocalQaOrigin(supplierRequest, new URL("http://buyer.localhost:3014"), environment), false);
  assert.equal(isAllowedLocalQaOrigin(supplierRequest, new URL("http://supplier.localhost:3014"), { ...environment, NODE_ENV: "production" }), false);
  assert.equal(isAllowedLocalQaOrigin(new Request("http://evil.localhost:3014/api"), new URL("http://evil.localhost:3014"), environment), false);
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAuth = process.env.KAI_ADMIN_LOCAL_AUTH;
  const previousMultiRole = process.env.KAI_ADMIN_LOCAL_MULTI_ROLE_QA;
  const previousOrigin = process.env.KAI_PUBLIC_ORIGIN;
  process.env.NODE_ENV = "development";
  process.env.KAI_ADMIN_LOCAL_AUTH = "1";
  process.env.KAI_ADMIN_LOCAL_MULTI_ROLE_QA = "1";
  process.env.KAI_PUBLIC_ORIGIN = "http://127.0.0.1:3014";
  try { assert.doesNotThrow(() => assertAccountAuthSameOrigin(supplierRequest)); }
  finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    if (previousAuth === undefined) delete process.env.KAI_ADMIN_LOCAL_AUTH; else process.env.KAI_ADMIN_LOCAL_AUTH = previousAuth;
    if (previousMultiRole === undefined) delete process.env.KAI_ADMIN_LOCAL_MULTI_ROLE_QA; else process.env.KAI_ADMIN_LOCAL_MULTI_ROLE_QA = previousMultiRole;
    if (previousOrigin === undefined) delete process.env.KAI_PUBLIC_ORIGIN; else process.env.KAI_PUBLIC_ORIGIN = previousOrigin;
  }
});
