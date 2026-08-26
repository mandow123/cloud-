import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { cardHourSchemaStatements } from "../db/card-hour-schema.ts";
import { hostingV2SchemaStatements } from "../db/hosting-v2-schema.ts";
import { createManagedGpuStore } from "../lib/server/managed-gpu-store-core.ts";

const values = (items = []) => items.map((item) => item === undefined ? null : item);
async function testStore() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const sql of [...cardHourSchemaStatements,...hostingV2SchemaStatements]) database.exec(sql);
  const adapter = {
    async first(sql,items=[]) { return database.prepare(sql).get(...values(items)) ?? null; },
    async all(sql,items=[]) { return database.prepare(sql).all(...values(items)); },
    async run(sql,items=[]) { return {changes:Number(database.prepare(sql).run(...values(items)).changes)}; },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result=statements.map((item)=>({changes:Number(database.prepare(item.sql).run(...values(item.values)).changes)}));
        database.exec("COMMIT"); return result;
      } catch(error) { database.exec("ROLLBACK"); throw error; }
    },
    async ensureSchema(statements,version) { for(const sql of statements) database.exec(sql); database.prepare("INSERT OR IGNORE INTO managed_gpu_schema_migrations(version,applied_at) VALUES(?,?)").run(version,new Date().toISOString()); },
  };
  return {database,store:await createManagedGpuStore(adapter)};
}

const digest=(value)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function approval(store,actionType,targetId,body,label) {
  const payloadHash=digest(body), now="2026-08-26T08:00:00.000Z";
  const requested=await store.requestApproval({organizationId:"org-admin",accountId:"admin-a",idempotencyKey:`request-${label}`,payloadHash:"1".repeat(64),now},{actionType,targetId,commandPayloadHash:payloadHash,commandPayload:body});
  await store.approveApproval({organizationId:"org-admin",accountId:"admin-b",idempotencyKey:`approve-${label}`,payloadHash:"2".repeat(64),now},requested.record.id,{expectedVersion:1,actionType});
  return {organizationId:"org-admin",accountId:"admin-a",idempotencyKey:`execute-${label}`,payloadHash,approvalId:requested.record.id,now};
}

test("managed GPU operations publish only dual-approved, evidenced and versioned configuration",async()=>{
  const {database,store}=await testStore();
  const seededCatalog=await store.listCatalog();
  assert.deepEqual(seededCatalog.records,[],"reference-only seed products must never enter the public catalog");
  assert.deepEqual(seededCatalog.facilities,[],"unverified planned facilities must never enter the public catalog");

  const facilityBody={expectedVersion:1,custodyTermsVersion:"BEIDOU_CUSTODY_2026_01",verificationEvidenceDigest:"a".repeat(64)};
  await store.activateFacility(await approval(store,"ACTIVATE_FACILITY","MGPU-FAC-BEIDOU-REFERENCE",facilityBody,"facility"),"MGPU-FAC-BEIDOU-REFERENCE",facilityBody);
  assert.equal(database.prepare("SELECT status FROM managed_gpu_facilities WHERE id='MGPU-FAC-BEIDOU-REFERENCE'").get().status,"ACTIVE");

  const productBody={hardwareClassId:"NVIDIA_RTX_5090",sku:"RTX5090-VERIFIED-2026-01",manufacturer:"NVIDIA",model:"RTX 5090",displayName:"RTX 5090 已核验批次",sellerName:"Verified Supplier",gpuModel:"RTX 5090",hardwareTier:"CONSUMER",vramGb:32,specs:{inventorySource:"WAREHOUSE_A"},verifiedInventoryCount:2,inventoryEvidenceDigest:"b".repeat(64),currency:"CNY",warrantyMonths:24,estimatedDeliveryDays:14,fulfillmentModes:["BEIDOU_HOSTING","GLOBAL_SHIPPING"],facilityIds:["MGPU-FAC-BEIDOU-REFERENCE"],quoteValidUntil:"2026-09-26T08:00:00.000Z"};
  const published=await store.publishProductVersion(await approval(store,"PUBLISH_PRODUCT_VERSION",productBody.sku,productBody,"product"),productBody);
  assert.equal(published.record.sellable,true);
  assert.equal(published.record.specs.verifiedInventoryCount,2);
  const verifiedCatalog=await store.listCatalog();
  assert.deepEqual(verifiedCatalog.records.map((record)=>record.id),[published.record.id]);
  assert.deepEqual(verifiedCatalog.facilities.map((facility)=>facility.id),["MGPU-FAC-BEIDOU-REFERENCE"]);
  await store.createQuote({organizationId:"org-invited",accountId:"buyer",idempotencyKey:"quote-verified",payloadHash:"3".repeat(64),now:"2026-08-26T09:00:00.000Z"},{productVersionId:published.record.id,facilityId:"MGPU-FAC-BEIDOU-REFERENCE",quantity:2,fulfillmentChoice:"BEIDOU_HOSTING",requestedCurrency:"CNY",destinationCountryCode:null});

  const policyBody={policyCode:"BEIDOU_HOSTING_CHARGE",versionNumber:1,facilityId:"MGPU-FAC-BEIDOU-REFERENCE",facilityChargeMicrosPerAssetDay:1_000_000,calculation:{basis:"ASSET_DAY"},effectiveFrom:"2026-08-26T00:00:00.000Z",effectiveUntil:null};
  const policy=await store.publishEconomicPolicy(await approval(store,"PUBLISH_ECONOMIC_POLICY",`${policyBody.policyCode}:1`,policyBody,"policy"),policyBody);
  assert.equal(policy.record.facilityChargeMicrosPerAssetDay,1_000_000);
  const stored=JSON.parse(database.prepare("SELECT calculation_json FROM managed_gpu_economic_policy_versions WHERE id=?").get(policy.record.id).calculation_json);
  assert.equal(stored.platformFee,"SERVER_DERIVED_LIFETIME_TIER");
  assert.equal(stored.wearReserve,"SERVER_DERIVED_HARDWARE_TIER");
  database.close();
});

test("managed GPU configuration commands fail closed without matching dual approval",async()=>{
  const {database,store}=await testStore();
  const facilityBody={expectedVersion:1,custodyTermsVersion:"BEIDOU_CUSTODY_2026_01",verificationEvidenceDigest:"a".repeat(64)};
  await assert.rejects(
    store.activateFacility({organizationId:"org-admin",accountId:"admin-a",idempotencyKey:"no-approval",payloadHash:digest(facilityBody),now:"2026-08-26T08:00:00.000Z"},"MGPU-FAC-BEIDOU-REFERENCE",facilityBody),
    (error)=>error?.code==="MANAGED_GPU_DUAL_APPROVAL_REQUIRED",
  );
  assert.deepEqual({...database.prepare("SELECT status,custody_terms_version FROM managed_gpu_facilities WHERE id='MGPU-FAC-BEIDOU-REFERENCE'").get()},{status:"PLANNED",custody_terms_version:"PENDING"});

  const approved=await approval(store,"ACTIVATE_FACILITY","MGPU-FAC-BEIDOU-REFERENCE",facilityBody,"facility-mismatch");
  await assert.rejects(
    store.activateFacility({...approved,payloadHash:"f".repeat(64)},"MGPU-FAC-BEIDOU-REFERENCE",facilityBody),
    (error)=>error?.code==="MANAGED_GPU_APPROVAL_INVALID",
  );
  assert.deepEqual({...database.prepare("SELECT status,custody_terms_version FROM managed_gpu_facilities WHERE id='MGPU-FAC-BEIDOU-REFERENCE'").get()},{status:"PLANNED",custody_terms_version:"PENDING"});
  assert.equal(database.prepare("SELECT consumed_at FROM managed_gpu_approvals WHERE id=?").get(approved.approvalId).consumed_at,null);
  database.close();
});

test("managed GPU administrator configuration routes require the feature gate, server authorization and exact permissions",()=>{
  const routes=[
    ["../app/api/v1/admin/managed-gpu/catalog/products/route.ts","MARKET_PUBLISH","publishProductVersion"],
    ["../app/api/v1/admin/managed-gpu/facilities/[facilityId]/activate/route.ts","FULFILLMENT_OPERATE","activateFacility"],
    ["../app/api/v1/admin/managed-gpu/economic-policies/route.ts","SETTLEMENT_OPERATE","publishEconomicPolicy"],
  ];
  for(const [path,permission,operation] of routes){
    const source=readFileSync(new URL(path,import.meta.url),"utf8");
    assert.match(source,/requireManagedGpuFeature\(\)/u);
    assert.match(source,new RegExp(`managedGpuAdminMutation\\(request,\\s*\\["${permission}"\\]\\)`));
    assert.match(source,new RegExp(`\\.${operation}\\(`));
    assert.doesNotMatch(source,/request\.json\(\)/u,"routes must use the bounded shared JSON reader");
  }
  const guard=readFileSync(new URL("../lib/server/managed-gpu-admin-api.ts",import.meta.url),"utf8");
  assert.match(guard,/assertAccountAuthSameOrigin\(request\)/u);
  assert.match(guard,/requireAdminPermission\(request, permissions\)/u);
  assert.match(guard,/x-kai-approval-id/u);
  assert.match(guard,/accountAuthDigest\(JSON\.stringify\(input\)\)/u);
});
