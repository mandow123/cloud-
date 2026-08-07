import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createSqliteAdminOperationsStore } from "../lib/server/admin-store-sqlite.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { accountAuthDigest } from "../lib/server/account-auth.ts";
import { ADMIN_ROLES } from "../lib/admin-auth-types.ts";

const context=(principalId:string,key:string,payloadHash=key)=>({principalId,idempotencyKey:`admin-test-${key.padEnd(16,"x")}`,payloadHash});
function fixture(){const directory=mkdtempSync(join(tmpdir(),"kai-admin-"));const path=join(directory,"test.sqlite");const db=new DatabaseSync(path);db.exec("CREATE TABLE exchange_payment_intents(id TEXT PRIMARY KEY,order_id TEXT,provider TEXT,environment TEXT,amount_cents INTEGER,currency TEXT,status TEXT,provider_payment_id TEXT,expires_at TEXT,version INTEGER,created_at TEXT,updated_at TEXT)");db.prepare("INSERT INTO exchange_payment_intents VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run("pay-1","order-1","TEST","TEST",5000,"CNY","CAPTURED",null,"2026-09-01",3,"2026-08-01","2026-08-01");db.exec("CREATE TABLE supply_offers(id TEXT PRIMARY KEY,supplier_actor_id TEXT,supplier_type TEXT,resource_type TEXT,quantity INTEGER,quantity_unit TEXT,pricing_unit TEXT,product_name TEXT,specification TEXT,region TEXT,delivery_form TEXT,status TEXT,version INTEGER,created_at TEXT,updated_at TEXT)");db.prepare("INSERT INTO supply_offers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("offer-1","legacy-supplier","COMPANY","GPU_CARD",8,"CARD","CARD_HOUR","H100 cards","8 x H100","上海","ACCOUNT","SUBMITTED",1,"2026-08-01","2026-08-01");db.close();return{path,cleanup:()=>rmSync(directory,{recursive:true,force:true})};}

test("work items are idempotent and version guarded",async()=>{const f=fixture();const store=await createSqliteAdminOperationsStore(f.path);try{const actor=context("principal-a","create-work");const input={sourceSystem:"MARKETPLACE",entityType:"DEMAND",entityId:"d-1",workType:"DEMAND_REVIEW",title:"Review demand",summary:"Review suspicious pricing",priority:"HIGH"};const first=await store.createWorkItem(actor,input);const replay=await store.createWorkItem(actor,input);assert.equal(first.replayed,false);assert.equal(replay.replayed,true);assert.equal(replay.record.id,first.record.id);await assert.rejects(()=>store.updateWorkItem(first.record.id,context("principal-a","update-work"),{expectedVersion:2,status:"RESOLVED",reason:"Evidence has been reviewed"}),/version changed/i);const updated=await store.updateWorkItem(first.record.id,context("principal-a","update-work-2"),{expectedVersion:1,status:"RESOLVED",reason:"Evidence has been reviewed"});assert.equal(updated.record.version,2);assert.equal(updated.record.status,"RESOLVED");}finally{store.close();f.cleanup();}});

test("refund approval is dual-control and never mutates payment state",async()=>{const f=fixture();const store=await createSqliteAdminOperationsStore(f.path);try{const requested=await store.requestRefund(context("finance-requester","refund-request"),{sourceSystem:"EXCHANGE",entityType:"PAYMENT_INTENT",entityId:"pay-1",amountCents:1200,expectedVersion:3,reason:"Customer service refund request"});await assert.rejects(()=>store.decideRefund(requested.record.id,context("finance-requester","refund-self"),{expectedVersion:1,decision:"APPROVED",reason:"I approve my own refund"}),/cannot approve/i);const approved=await store.decideRefund(requested.record.id,context("finance-approver","refund-approve"),{expectedVersion:1,decision:"APPROVED",reason:"Independent evidence reviewed"});assert.equal(approved.record.status,"APPROVED");const db=new DatabaseSync(f.path);const payment=db.prepare("SELECT status,version FROM exchange_payment_intents WHERE id='pay-1'").get() as {status:string;version:number};db.close();assert.equal(payment.status,"CAPTURED");assert.equal(payment.version,3);}finally{store.close();f.cleanup();}});

test("approved refund execution is claimed once, records failure, and retries with the stable provider request id",async()=>{const f=fixture();const store=await createSqliteAdminOperationsStore(f.path);try{const requested=await store.requestRefund(context("finance-requester","refund-exec-request"),{sourceSystem:"EXCHANGE",entityType:"PAYMENT_INTENT",entityId:"pay-1",amountCents:1200,expectedVersion:3,reason:"Customer service refund request"});await store.decideRefund(requested.record.id,context("finance-approver","refund-exec-approve"),{expectedVersion:1,decision:"APPROVED",reason:"Independent evidence reviewed"});const first=await store.beginRefundExecution(requested.record.id,context("finance-approver","refund-exec-first"),"Initial approved refund execution");assert.equal(first.claimed,true);assert.equal(first.record.execution?.status,"PROCESSING");const concurrent=await store.beginRefundExecution(requested.record.id,context("finance-other","refund-exec-concurrent"),"Concurrent approved refund execution");assert.equal(concurrent.claimed,false);assert.equal(concurrent.record.execution?.refundRequestId,first.record.execution?.refundRequestId);const failed=await store.finishRefundExecution(requested.record.id,context("finance-approver","refund-exec-fail"),{claimToken:first.record.execution!.claimToken,status:"FAILED",errorCode:"ALIPAY_TIMEOUT",errorMessage:"Provider timeout"});assert.equal(failed.record.execution?.status,"FAILED");const retried=await store.beginRefundExecution(requested.record.id,context("finance-approver","refund-exec-retry"),"Retry after provider timeout");assert.equal(retried.claimed,true);assert.equal(retried.record.execution?.attemptCount,2);assert.equal(retried.record.execution?.refundRequestId,first.record.execution?.refundRequestId);const succeeded=await store.finishRefundExecution(requested.record.id,context("finance-approver","refund-exec-success"),{claimToken:retried.record.execution!.claimToken,status:"SUCCEEDED",providerTransactionRef:"ali-trade-1"});assert.equal(succeeded.record.execution?.status,"SUCCEEDED");const after=await store.beginRefundExecution(requested.record.id,context("finance-other","refund-exec-after"),"Observe completed refund execution");assert.equal(after.claimed,false);assert.equal(after.record.execution?.attemptCount,2);}finally{store.close();f.cleanup();}});

test("entity ownership requires expected version and exposes explicit legacy classification",async()=>{const f=fixture();const store=await createSqliteAdminOperationsStore(f.path);try{const legacy=(await store.readProjection("supply-offers"))[0];assert.equal(legacy.sourceSystem,"SUPPLY_PILOT");assert.equal(legacy.ownership.classification,"LEGACY_ANON");await assert.rejects(()=>store.bindEntityOrganization(context("admin","bind-invalid"),{sourceSystem:"SUPPLY_PILOT",entityType:"SUPPLY_OFFER",entityId:"offer-1",organizationId:"org-1",accountId:"acc-1",expectedVersion:1,reason:"Bind verified organization"}),/does not exist/i);const bound=await store.bindEntityOrganization(context("admin","bind-create"),{sourceSystem:"SUPPLY_PILOT",entityType:"SUPPLY_OFFER",entityId:"offer-1",organizationId:"org-1",accountId:"acc-1",legacyActorId:"legacy-supplier",expectedVersion:0,reason:"Bind verified organization"});assert.equal(bound.record.classification,"BOUND");assert.equal(bound.record.version,1);const projected=(await store.readProjection("supply-offers"))[0];assert.equal(projected.ownership.classification,"BOUND");assert.equal(projected.ownership.organizationId,"org-1");}finally{store.close();f.cleanup();}});

test("administrator principals come from identity facts and support audited versioned management",async()=>{
  const f=fixture();const auth=await createSqliteAccountAuthStore(f.path);const at="2026-08-07T06:00:00.000Z";
  const bootstrap=await auth.resolveOrCreateIdentity({provider:"LOCAL",tenantKey:"LOCAL",subject:"test-bootstrap",displayName:"Local Bootstrap",normalizedEmail:null,organizationExternalKey:"LOCAL:KAI",organizationName:"KAI Local Development",verifiedAt:at});
  await auth.activateMembership(bootstrap.membership.id,["ROLE_ADMIN"],at);
  await auth.resolveOrCreateIdentity({provider:"LARK",tenantKey:"allowed-tenant",subject:"unknown-open-id",displayName:"Unknown Lark User",normalizedEmail:null,organizationExternalKey:"LARK:allowed-tenant",organizationName:"KAI Lark",verifiedAt:at});
  const store=await createSqliteAdminOperationsStore(f.path);const actor=(key:string)=>({...context(bootstrap.account.id,key),organizationId:bootstrap.organization.id});
  try{
    const before=await store.listPrincipals();assert.equal(before.length,1);assert.equal(before[0]?.displayName,"Local Bootstrap");assert.deepEqual(before[0]?.roles,["ROLE_ADMIN"]);assert.equal(before[0]?.version,0);
    const catalog=await store.listRoles();assert.deepEqual(catalog.map((item)=>item.code),ADMIN_ROLES);assert.ok(catalog.every((item)=>item.source==="AUTHORIZATION_POLICY"));
    const input={email:"operator@kai.example",displayName:"KAI Operator",roles:["INTAKE_OPERATOR","MARKET_OPERATOR"],expectedVersion:0,reason:"Invite approved KAI operator"};
    const invited=await store.invitePrincipal(actor("invite-principal"),input);const replay=await store.invitePrincipal(actor("invite-principal"),input);assert.equal(invited.replayed,false);assert.equal(replay.replayed,true);assert.equal(replay.record.id,invited.record.id);
    await assert.rejects(()=>store.invitePrincipal(actor("invalid-role"),{...input,email:"invalid@kai.example",roles:["ROOT"]}),/unsupported administrator role/i);
    const emailHash=await accountAuthDigest("operator@kai.example");const loginIdentity=await auth.resolveOrCreateIdentity({provider:"EMAIL",tenantKey:"EXTERNAL",subject:emailHash,displayName:"operator",normalizedEmail:"operator@kai.example",organizationExternalKey:`EMAIL:${emailHash}`,organizationName:"External account",verifiedAt:at});
    assert.equal(loginIdentity.organization.id,bootstrap.organization.id);assert.equal(loginIdentity.membership.status,"ACTIVE");assert.deepEqual(loginIdentity.membership.roles,["INTAKE_OPERATOR","MARKET_OPERATOR"]);
    await assert.rejects(()=>store.assignPrincipalRoles(String(invited.record.id),actor("stale-roles"),{roles:["FINANCE_OPERATOR"],expectedVersion:0,reason:"Approved finance responsibility"}),/version changed/i);
    const assigned=await store.assignPrincipalRoles(String(invited.record.id),actor("assign-roles"),{roles:["FINANCE_OPERATOR"],expectedVersion:1,reason:"Approved finance responsibility"});assert.deepEqual(assigned.record.roles,["FINANCE_OPERATOR"]);assert.equal(assigned.record.version,2);
    const suspended=await store.updatePrincipalStatus(String(invited.record.id),actor("suspend-principal"),{status:"SUSPENDED",expectedVersion:2,reason:"Access removed after role change"});assert.equal(suspended.record.status,"SUSPENDED");assert.equal(suspended.record.version,3);
    await assert.rejects(()=>store.updatePrincipalStatus(bootstrap.account.id,actor("suspend-last-admin"),{status:"SUSPENDED",expectedVersion:0,reason:"Attempt to remove final administrator"}),/at least one active ROLE_ADMIN/i);
    const audit=await store.listAuditEvents({sourceSystem:"ADMIN",limit:20});assert.deepEqual(audit.map((item)=>item.action).sort(),["ADMIN_PRINCIPAL_INVITED","ADMIN_PRINCIPAL_ROLES_ASSIGNED","ADMIN_PRINCIPAL_SUSPENDED"].sort());
  }finally{store.close();auth.close();f.cleanup();}
});

async function twoRoleAdminFixture(){
  const f=fixture(),auth=await createSqliteAccountAuthStore(f.path),at="2026-08-08T06:00:00.000Z";
  const first=await auth.resolveOrCreateIdentity({provider:"LOCAL",tenantKey:"LOCAL",subject:`concurrency-${crypto.randomUUID()}`,displayName:"First Admin",normalizedEmail:null,organizationExternalKey:"LOCAL:KAI",organizationName:"KAI Local Development",verifiedAt:at});
  await auth.activateMembership(first.membership.id,["ROLE_ADMIN"],at);
  const storeA=await createSqliteAdminOperationsStore(f.path),actor=(principalId:string,key:string)=>({...context(principalId,key),organizationId:first.organization.id});
  const secondResult=await storeA.invitePrincipal(actor(first.account.id,"invite-second-admin"),{email:`second-${crypto.randomUUID()}@kai.example`,displayName:"Second Admin",roles:["ROLE_ADMIN"],expectedVersion:0,reason:"Invite second continuity administrator"});
  const storeB=await createSqliteAdminOperationsStore(f.path);
  return{f,auth,storeA,storeB,first,secondId:String(secondResult.record.id),actor,cleanup(){storeA.close();storeB.close();auth.close();f.cleanup();}};
}

test("concurrent ROLE_ADMIN role revocations cannot remove the final active administrator",async()=>{
  const x=await twoRoleAdminFixture();
  try{
    const results=await Promise.allSettled([
      x.storeA.assignPrincipalRoles(x.first.account.id,x.actor(x.first.account.id,"revoke-first-admin"),{roles:[],expectedVersion:0,reason:"Concurrent role revocation test first"}),
      x.storeB.assignPrincipalRoles(x.secondId,x.actor(x.secondId,"revoke-second-admin"),{roles:[],expectedVersion:1,reason:"Concurrent role revocation test second"}),
    ]);
    assert.equal(results.filter((item)=>item.status==="fulfilled").length,1);assert.equal(results.filter((item)=>item.status==="rejected").length,1);
    const principals=await x.storeA.listPrincipals();assert.equal(principals.filter((item)=>item.status==="ACTIVE"&&(item.roles as string[]).includes("ROLE_ADMIN")).length,1);
  }finally{x.cleanup();}
});

test("concurrent ROLE_ADMIN suspensions cannot disable the final active administrator",async()=>{
  const x=await twoRoleAdminFixture();
  try{
    const results=await Promise.allSettled([
      x.storeA.updatePrincipalStatus(x.first.account.id,x.actor(x.first.account.id,"suspend-first-admin"),{status:"SUSPENDED",expectedVersion:0,reason:"Concurrent suspension test first"}),
      x.storeB.updatePrincipalStatus(x.secondId,x.actor(x.secondId,"suspend-second-admin"),{status:"SUSPENDED",expectedVersion:1,reason:"Concurrent suspension test second"}),
    ]);
    assert.equal(results.filter((item)=>item.status==="fulfilled").length,1);assert.equal(results.filter((item)=>item.status==="rejected").length,1);
    const principals=await x.storeA.listPrincipals();assert.equal(principals.filter((item)=>item.status==="ACTIVE"&&(item.roles as string[]).includes("ROLE_ADMIN")).length,1);
  }finally{x.cleanup();}
});

test("D1 and local admin migrations stay identical",()=>{assert.equal(readFileSync(new URL("../drizzle/0015_admin_operations.sql",import.meta.url),"utf8"),readFileSync(new URL("../.openai/drizzle/0015_admin_operations.sql",import.meta.url),"utf8"));});
test("administrator management migration stays identical",()=>{assert.equal(readFileSync(new URL("../drizzle/0017_admin_principal_management.sql",import.meta.url),"utf8"),readFileSync(new URL("../.openai/drizzle/0017_admin_principal_management.sql",import.meta.url),"utf8"));});
test("refund execution migrations stay identical",()=>{assert.equal(readFileSync(new URL("../drizzle/0016_admin_refund_execution.sql",import.meta.url),"utf8"),readFileSync(new URL("../.openai/drizzle/0016_admin_refund_execution.sql",import.meta.url),"utf8"));});
