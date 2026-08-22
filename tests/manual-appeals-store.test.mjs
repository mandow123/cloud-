import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { POST as createAppealRoute } from "../app/api/v1/member/purchases/[demandId]/appeals/route.ts";
import { createD1AdminOperationsStore } from "../lib/server/admin-store-d1.ts";
import { createSqliteAdminOperationsStore } from "../lib/server/admin-store-sqlite.ts";
import { manualAppealsEnabled, redactAdminManualAppealEvidence } from "../lib/server/manual-appeals.ts";

class FakeD1Statement {
  constructor(database, sql, values = []) { this.database=database; this.sql=sql; this.values=values; }
  bind(...values) { return new FakeD1Statement(this.database,this.sql,values); }
  execute(mode) { const statement=this.database.prepare(this.sql); if(mode==="first")return statement.get(...this.values)??null; if(mode==="all")return statement.all(...this.values); const result=statement.run(...this.values); return{results:[],success:true,meta:{changes:Number(result.changes)}}; }
  async run(){return this.execute("run");} async all(){return{results:this.execute("all"),success:true,meta:{changes:0}};} async first(){return this.execute("first");}
}
class FakeD1Database {
  constructor(){this.database=new DatabaseSync(":memory:",{enableForeignKeyConstraints:true});}
  prepare(sql){return new FakeD1Statement(this.database,sql);}
  async batch(statements){this.database.exec("BEGIN IMMEDIATE");try{const results=statements.map((statement)=>statement.execute("run"));this.database.exec("COMMIT");return results;}catch(error){this.database.exec("ROLLBACK");throw error;}}
  close(){this.database.close();}
}

const resourceSnapshot={id:"gpu-appeal-h200",title:"H200 NVL 单卡",supplierId:"supplier-source",supplierName:"安全供应商",supplierLogoUrl:null,category:"gpu",region:"华东",deliveryForm:"人工 SSH",summary:"人工交付测试资源",capacity:"1 卡",sla:"人工确认",deliveryLeadTime:"人工确认",sourceNotice:null,gpuDescription:"NVIDIA H200 NVL × 1",gpuPackageCount:1,specs:{GPU:"H200 NVL × 1"}};
const context=(principalId,organizationId,key,hash=key)=>({principalId,organizationId,idempotencyKey:key,payloadHash:hash});
const assertCode=(code)=>(error)=>error?.code===code;

async function seedPurchase(store,raw,suffix){
  const buyer=`buyer-${suffix}`,buyerOrg=`buyer-org-${suffix}`,supplierOrg=`supplier-org-${suffix}`,demandId=`demand-${suffix}`;
  await store.bindEntityOrganization(context(buyer,buyerOrg,`own-${suffix}`),{sourceSystem:"MARKETPLACE",entityType:"DEMAND",entityId:demandId,organizationId:buyerOrg,accountId:buyer,expectedVersion:0,reason:"Bind verified buyer demand ownership."});
  await store.recordManualDeliveryIntake(context(buyer,buyerOrg,`intake-${suffix}`),{demandId,buyerAccountId:buyer,resourceId:resourceSnapshot.id,resourceTitle:resourceSnapshot.title,canonicalSshPublicKey:"ssh-ed25519 AAAATEST",sshPublicKeyFingerprint:`SHA256:${"A".repeat(43)}`});
  await store.recordCatalogPurchaseIntentSnapshot(context(buyer,buyerOrg,`snapshot-${suffix}`),{demandId,buyerAccountId:buyer,resourceSnapshot,quantity:1,durationHours:24,deliveryDate:"2026-09-01",pricingUnit:"卡时",unitPriceCnyCents:5900,unitCardHourMicros:58_882_236,estimatedCardHourMicros:1_413_173_664,sshPublicKeyFingerprint:`SHA256:${"A".repeat(43)}`});
  raw.prepare("UPDATE admin_manual_delivery_statuses SET supplier_organization_id=?,status='SUPPLIER_ASSIGNED',version=2 WHERE demand_id=?").run(supplierOrg,demandId);
  return{buyer,buyerOrg,supplierOrg,demandId};
}

function seedAdmin(raw,id,role){
  const now=new Date().toISOString(),org=`admin-org-${id}`,membership=`membership-${id}`;
  raw.prepare("INSERT OR IGNORE INTO admin_user_accounts(id,display_name,primary_email,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)").run(id,id,`${id}@example.test`,now,now);
  raw.prepare("INSERT OR IGNORE INTO admin_organizations(id,name,external_key,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)").run(org,org,org,now,now);
  raw.prepare("INSERT OR IGNORE INTO admin_memberships(id,account_id,organization_id,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)").run(membership,id,org,now,now);
  raw.prepare("INSERT OR IGNORE INTO admin_membership_roles(membership_id,role,granted_at,granted_by) VALUES(?,?,?,NULL)").run(membership,role,now);
}

async function exerciseStore(kind,store,raw){
  const ids=await seedPurchase(store,raw,kind);
  const createContext=context(ids.buyer,ids.buyerOrg,`create-${kind}`,"create-hash");
  const created=await store.createMemberManualAppeal(createContext,ids.demandId,{category:"CONNECTION_FAILURE",subject:"无法连接交付实例",description:"SSH 连接一直超时，请协助核对交付信息。"});
  assert.equal(created.replayed,false); assert.equal(created.record.status,"OPEN");
  assert.equal((await store.createMemberManualAppeal(createContext,ids.demandId,{category:"CONNECTION_FAILURE",subject:"无法连接交付实例",description:"SSH 连接一直超时，请协助核对交付信息。"})).replayed,true);
  await assert.rejects(()=>store.createMemberManualAppeal({...createContext,payloadHash:"different-hash"},ids.demandId,{category:"OTHER",subject:"different",description:"different payload"}),/IDEMPOTENCY_CONFLICT/u);
  assert.equal(await store.getMemberManualAppeal(`other-${ids.buyerOrg}`,created.record.id),null,"cross-organization buyer access must look absent");
  assert.equal(await store.getSupplierManualAppeal(`other-${ids.supplierOrg}`,created.record.id),null,"cross-organization supplier access must look absent");
  assert.equal((await store.getSupplierManualAppeal(ids.supplierOrg,created.record.id))?.buyerDisplayName?.startsWith("买家 "),true);

  await store.addAdminManualAppealMessage(context("admin-handler",null,`admin-note-${kind}`),created.record.id,{expectedVersion:1,visibility:"ADMIN_ONLY",body:"仅管理员可见的内部核对说明。"});
  const partyAfterAdminNote=await store.getMemberManualAppeal(ids.buyerOrg,created.record.id);
  assert.doesNotMatch(JSON.stringify(partyAfterAdminNote),/仅管理员可见|buyerOrganizationId|buyerAccountId|recordedByPrincipalId|verifiedFinancialReferenceId|object_ref|payload_digest/u);

  seedAdmin(raw,"support-no-handle","SUPPORT_READONLY"); seedAdmin(raw,"admin-handler","FULFILLMENT_OPERATOR");
  await assert.rejects(()=>store.assignAdminManualAppeal(context("admin-handler",null,`assign-denied-${kind}`),created.record.id,{expectedVersion:2,adminPrincipalId:"support-no-handle"}),/appeal handling permission/i);
  const assigned=await store.assignAdminManualAppeal(context("admin-handler",null,`assign-${kind}`),created.record.id,{expectedVersion:2,adminPrincipalId:"admin-handler"});
  assert.equal(assigned.record.assignedAdminPrincipalId,"admin-handler"); assert.equal(assigned.record.version,3);
  const assignedReplay=await store.assignAdminManualAppeal(context("admin-handler",null,`assign-${kind}`),created.record.id,{expectedVersion:2,adminPrincipalId:"admin-handler"});
  assert.equal(assignedReplay.replayed,true); assert.equal(assignedReplay.record.assignedAdminPrincipalId,"admin-handler");
  await assert.rejects(()=>store.transitionAdminManualAppeal(context("admin-handler",null,`stale-${kind}`),created.record.id,{expectedVersion:1,action:"TRIAGE"}),assertCode("EXCHANGE_VERSION_CONFLICT"));
  await assert.rejects(()=>store.transitionAdminManualAppeal(context("admin-handler",null,`illegal-${kind}`),created.record.id,{expectedVersion:3,action:"RESOLVE"}),assertCode("EXCHANGE_STATE_CONFLICT"));
  const triaged=await store.transitionAdminManualAppeal(context("admin-handler",null,`triage-${kind}`),created.record.id,{expectedVersion:3,action:"TRIAGE"});
  const proposed=await store.transitionAdminManualAppeal(context("admin-handler",null,`propose-${kind}`),created.record.id,{expectedVersion:triaged.record.version,action:"PROPOSE_RESOLUTION",resolutionOutcome:"OFFLINE_REFUND_RECOMMENDED",resolutionSummary:"建议管理员在线下核对原支付事实后人工处理。"});

  const now=new Date().toISOString(),referenceId=`financial-${kind}`,wrongReferenceId=`financial-wrong-${kind}`,evidenceId=`evidence-${kind}`;
  const insertFinancial=raw.prepare("INSERT INTO admin_verified_financial_references(id,buyer_organization_id,source_system,source_entity_id,amount_minor,currency,status,evidence_digest,verified_at) VALUES(?,?,?,?,?,'CNY','VERIFIED',?,?)");
  insertFinancial.run(wrongReferenceId,ids.buyerOrg,"MARKETPLACE",`other-demand-${kind}`,5900,"wrong-evidence-digest",now);
  await assert.rejects(()=>store.createAdminManualAppealOfflineRefund(context("finance-recorder",null,`wrong-refund-${kind}`),created.record.id,{expectedVersion:proposed.record.version,verifiedFinancialReferenceId:wrongReferenceId,amountMinor:5900,currency:"CNY",method:"BANK_TRANSFER",maskedReference:"****1234"}),assertCode("VERIFIED_FINANCIAL_SOURCE_REQUIRED"));
  insertFinancial.run(referenceId,ids.buyerOrg,"MARKETPLACE",ids.demandId,5900,"evidence-digest",now);
  const refund=await store.createAdminManualAppealOfflineRefund(context("finance-recorder",null,`refund-${kind}`),created.record.id,{expectedVersion:proposed.record.version,verifiedFinancialReferenceId:referenceId,amountMinor:5900,currency:"CNY",method:"BANK_TRANSFER",maskedReference:"****1234"});
  await assert.rejects(()=>store.createAdminManualAppealOfflineRefund(context("finance-other",null,`duplicate-refund-${kind}`),created.record.id,{expectedVersion:proposed.record.version,verifiedFinancialReferenceId:referenceId,amountMinor:5900,currency:"CNY",method:"BANK_TRANSFER",maskedReference:"****1234"}),assertCode("EXCHANGE_VERSION_CONFLICT"));
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM admin_manual_appeal_offline_refunds WHERE case_id=? AND verified_financial_reference_id=?").get(created.record.id,referenceId).count,1);
  const refundId=refund.record.offlineRefunds[0].id;
  const processing=await store.transitionAdminManualAppealOfflineRefund(context("finance-recorder",null,`processing-${kind}`),created.record.id,refundId,{expectedVersion:1,action:"START_PROCESSING"});
  raw.prepare("INSERT INTO admin_manual_appeal_evidence(id,case_id,object_ref,sha256,scan_status,created_by_principal_id,created_at) VALUES(?,?,?,?, 'SAFE',?,?)").run(evidenceId,created.record.id,`private://appeals/${kind}`,"b".repeat(64),"finance-recorder",now);
  const submitted=await store.transitionAdminManualAppealOfflineRefund(context("finance-recorder",null,`proof-${kind}`),created.record.id,refundId,{expectedVersion:processing.record.offlineRefunds[0].version,action:"SUBMIT_PROOF",proofEvidenceId:evidenceId,externalReferenceHash:"c".repeat(64)});
  const proofVersion=submitted.record.offlineRefunds[0].version;
  await assert.rejects(()=>store.verifyAdminManualAppealOfflineRefund(context("finance-recorder",null,`self-verify-${kind}`),created.record.id,refundId,{expectedVersion:proofVersion}),assertCode("OFFLINE_REFUND_TWO_PERSON_REQUIRED"));
  const verified=await store.verifyAdminManualAppealOfflineRefund(context("finance-verifier",null,`verify-${kind}`),created.record.id,refundId,{expectedVersion:proofVersion});
  assert.equal(verified.record.offlineRefunds[0].status,"INDEPENDENTLY_VERIFIED"); assert.equal(verified.record.offlineRefunds[0].verifiedByPrincipalId,"finance-verifier");
  assert.doesNotMatch(JSON.stringify(redactAdminManualAppealEvidence(verified.record)),/finance-recorder|finance-verifier|financial-|private:\/\/|externalReferenceHash|proofEvidenceId|recordedByPrincipalId|verifiedByPrincipalId|verifiedFinancialReferenceId/u);
  const buyerSafe=await store.getMemberManualAppeal(ids.buyerOrg,created.record.id);
  assert.equal(buyerSafe?.offlineRefunds[0].status,"INDEPENDENTLY_VERIFIED");
  assert.doesNotMatch(JSON.stringify(buyerSafe),/finance-recorder|finance-verifier|financial-|private:\/\/|externalReferenceHash|proofEvidenceId|recordedByPrincipalId/u);
}

test("manual appeals persist safely in the real SQLite adapter",async()=>{const directory=mkdtempSync(join(tmpdir(),"kai-appeals-")),path=join(directory,"appeals.sqlite"),store=await createSqliteAdminOperationsStore(path),raw=new DatabaseSync(path);try{await exerciseStore("sqlite",store,raw);}finally{raw.close();store.close();rmSync(directory,{recursive:true,force:true});}});
test("manual appeals preserve the same isolation and invariants through the D1 adapter",async()=>{const database=new FakeD1Database(),store=await createD1AdminOperationsStore(database);try{await exerciseStore("d1",store,database.database);}finally{database.close();}});

test("manual appeal APIs fail closed and the sidecar has no provider, ledger, contract, inventory, or Agent dependency",async()=>{
  const previous=process.env.KAI_MANUAL_APPEALS_V1;delete process.env.KAI_MANUAL_APPEALS_V1;
  try{
    assert.equal(manualAppealsEnabled({}),false);
    const response=await createAppealRoute(new Request("http://localhost:3014/api/v1/member/purchases/demand-off/appeals",{method:"POST"}),{params:Promise.resolve({demandId:"demand-off"})});
    assert.equal(response.status,404);assert.equal((await response.json()).error.code,"MANUAL_APPEALS_NOT_FOUND");
  }finally{if(previous==null)delete process.env.KAI_MANUAL_APPEALS_V1;else process.env.KAI_MANUAL_APPEALS_V1=previous;}
  const collect=(directory)=>readdirSync(directory).flatMap((name)=>{const path=join(directory,name);return statSync(path).isDirectory()?collect(path):[path];});
  const routeSource=collect("app/api/v1").filter((path)=>path.includes("appeal")&&!path.includes("card-hours")&&!path.includes("card-hour-topup")).map((path)=>readFileSync(path,"utf8")).join("\n");
  const core=readFileSync("lib/server/admin-store-core.ts","utf8"),sidecar=core.slice(core.indexOf("async function appealParts"),core.indexOf("async function transitionMemberOrder"));
  for(const forbidden of [/refundTrade/u,/decideAndExecuteRefund/u,/getSupplyStore/u,/card[-_]?hour.*store/iu,/contract.*store/iu,/inventory.*store/iu,/agent.*store/iu]){
    assert.doesNotMatch(`${routeSource}\n${sidecar}`,forbidden);
  }
});
