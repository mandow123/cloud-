import { adminOperationsSchemaStatements, ADMIN_OPERATIONS_SCHEMA_VERSION } from "../../db/admin-operations-schema.ts";
import { adminIdentitySchemaStatements } from "../../db/admin-identity-schema.ts";
import { ADMIN_ROLES, type AdminRole } from "../admin-auth-types.ts";
import { adminPermissionsForRoles } from "./admin-auth.ts";
import { ExchangeDomainError, ExchangeIdempotencyConflictError, ExchangeInputError } from "./exchange-errors.ts";
import { countAdminProjection, readAdminProjection, type AdminProjectionAdapter } from "./admin-projections.ts";
import type { AdminEntityOwnership, AdminListQuery, AdminManualDeliveryIntake, AdminManualDeliveryPublicKey, AdminMutationContext, AdminOperationsStore, AdminProjectionName, AdminRefundCase, AdminRefundExecution, AdminSourceSystem, AdminWorkItem, MemberCatalogPurchaseIntent, MemberPersonalCounts } from "./admin-store.ts";

export type AdminSql = Readonly<{ sql: string; values?: readonly unknown[] }>;
export type AdminRunResult = Readonly<{ changes: number }>;
export interface AdminDatabaseAdapter extends AdminProjectionAdapter {
  first<T>(sql: string, values?: readonly unknown[]): Promise<T | null>;
  all<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  batch(statements: readonly AdminSql[]): Promise<AdminRunResult[]>;
  ensureSchema(statements: readonly string[], version: number): Promise<void>;
}
type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const id = (prefix: string) => `KAI-${prefix}-${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
const text = (value: unknown, field: string, max = 200) => { const v = typeof value === "string" ? value.trim() : ""; if (!v || v.length > max) throw new ExchangeInputError(`${field} is required and must be at most ${max} characters.`, field); return v; };
const optionalText = (value: unknown, field: string, max = 200) => value == null || value === "" ? null : text(value, field, max);
const positiveInt = (value: unknown, field: string) => { const v = Number(value); if (!Number.isSafeInteger(v) || v < 1) throw new ExchangeInputError(`${field} must be a positive integer.`, field); return v; };
const positiveNumber = (value: unknown, field: string) => { const v = Number(value); if (!Number.isFinite(v) || v <= 0 || v > 10_000_000) throw new ExchangeInputError(`${field} must be a positive number.`, field); return v; };
const nonNegativeInt = (value: unknown, field: string) => { const v = Number(value); if (!Number.isSafeInteger(v) || v < 0) throw new ExchangeInputError(`${field} must be a non-negative integer.`, field); return v; };
const source = (value: unknown, allowed: readonly AdminSourceSystem[] = ["MARKETPLACE","EXCHANGE","SUPPLY_PILOT","ADMIN"]) => { const v = value as AdminSourceSystem; if (!allowed.includes(v)) throw new ExchangeInputError("Unsupported sourceSystem.", "sourceSystem"); return v; };
const reason = (value: unknown) => { const v = text(value, "reason", 1000); if (v.length < 8) throw new ExchangeInputError("reason must contain at least 8 characters.", "reason"); return v; };
const limit = (query?: AdminListQuery) => Math.min(100, Math.max(1, Number(query?.limit ?? 50) || 50));
const jsonObject = (value: unknown, field: string) => { if (value == null) return {}; if (!value || typeof value !== "object" || Array.isArray(value)) throw new ExchangeInputError(`${field} must be an object.`, field); const encoded = JSON.stringify(value); if (encoded.length > 12000) throw new ExchangeInputError(`${field} is too large.`, field); return value as Record<string, unknown>; };
const adminOrganizationId = (context: AdminMutationContext) => text(context.organizationId, "organizationId");
const email = (value: unknown) => { const normalized=typeof value==="string"?value.trim().toLowerCase():""; if(normalized.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized))throw new ExchangeInputError("email must be a valid address.","email"); return normalized; };
const roles = (value: unknown) => { if(!Array.isArray(value))throw new ExchangeInputError("roles must be an array.","roles"); const unique=[...new Set(value)]; if(unique.some((role)=>typeof role!=="string"||!ADMIN_ROLES.includes(role as AdminRole)))throw new ExchangeInputError("roles contains an unsupported administrator role.","roles"); return unique as AdminRole[]; };
const assignableRoles = (value: unknown) => { const normalized=roles(value); if(normalized.includes("ROOT"))throw new ExchangeInputError("ROOT is system-managed and cannot be assigned, invited, or transferred.","roles"); return normalized; };
async function digestHex(value:string){const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));return Array.from(bytes,(byte)=>byte.toString(16).padStart(2,"0")).join("");}
async function digestId(prefix:string,value:string){return `${prefix}_${(await digestHex(value)).slice(0,40)}`;}

const ROLE_DESCRIPTIONS: Readonly<Record<AdminRole,string>> = {
  ROOT:"Unique system root with every permission; established only by trusted bootstrap or local preview configuration",
  ROLE_ADMIN:"Delegated administrator for operations; cannot manage or inherit Root authority",
  INTAKE_OPERATOR:"Supply submissions and buyer demand review",
  INVENTORY_OPERATOR:"KAI-owned assets and capacity pools",
  VERIFICATION_REVIEWER:"Verification evidence and decisions",
  MARKET_OPERATOR:"Capacity lots, listings and matching",
  FULFILLMENT_OPERATOR:"Delivery, access, metering and cleanup",
  FINANCE_OPERATOR:"Payment lookup, reconciliation and refund requests",
  FINANCE_APPROVER:"Independent financial approval",
  SUPPORT_READONLY:"Masked customer and order support view",
  AUDITOR:"Read-only audit and operational evidence",
};

const ADMIN_PROJECTION_NAMES: readonly AdminProjectionName[] = [
  "supply-offers",
  "demands",
  "matches",
  "pools",
  "verifications",
  "capacity-lots",
  "listings",
  "withdrawals",
  "swaps",
  "orders",
  "delivery",
  "metering",
  "payments",
  "settlements",
  "commissions",
  "standardization",
  "exceptions",
];

function workItem(row: Row): AdminWorkItem { return { id:String(row.id),sourceSystem:row.source_system as AdminSourceSystem,entityType:String(row.entity_type),entityId:String(row.entity_id),workType:String(row.work_type),title:String(row.title),summary:String(row.summary),status:row.status as AdminWorkItem["status"],priority:row.priority as AdminWorkItem["priority"],assigneePrincipalId:row.assignee_principal_id==null?null:String(row.assignee_principal_id),dueAt:row.due_at==null?null:String(row.due_at),metadata:JSON.parse(String(row.metadata_json)),createdBy:String(row.created_by),version:Number(row.version),createdAt:String(row.created_at),updatedAt:String(row.updated_at) }; }
function refundExecution(row: Row): AdminRefundExecution { return { refundCaseId:String(row.refund_case_id),provider:"ALIPAY",refundRequestId:String(row.refund_request_id),orderId:String(row.order_id),status:row.status as AdminRefundExecution["status"],attemptCount:Number(row.attempt_count),attemptedBy:String(row.attempted_by),claimToken:String(row.claim_token),providerTransactionRef:row.provider_transaction_ref==null?null:String(row.provider_transaction_ref),lastErrorCode:row.last_error_code==null?null:String(row.last_error_code),lastErrorMessage:row.last_error_message==null?null:String(row.last_error_message),lastAttemptAt:String(row.last_attempt_at),completedAt:row.completed_at==null?null:String(row.completed_at),version:Number(row.version),createdAt:String(row.created_at),updatedAt:String(row.updated_at) }; }
function refund(row: Row, execution: AdminRefundExecution | null = null): AdminRefundCase { return { id:String(row.id),sourceSystem:row.source_system as AdminRefundCase["sourceSystem"],entityType:String(row.entity_type),entityId:String(row.entity_id),amountCents:Number(row.amount_cents),currency:"CNY",businessExpectedVersion:Number(row.business_expected_version),status:row.status as AdminRefundCase["status"],requestedBy:String(row.requested_by),requestReason:String(row.request_reason),decidedBy:row.decided_by==null?null:String(row.decided_by),decisionReason:row.decision_reason==null?null:String(row.decision_reason),version:Number(row.version),createdAt:String(row.created_at),updatedAt:String(row.updated_at),decidedAt:row.decided_at==null?null:String(row.decided_at),execution }; }
function ownership(row: Row): AdminEntityOwnership { return { sourceSystem:row.source_system as AdminSourceSystem,entityType:String(row.entity_type),entityId:String(row.entity_id),organizationId:String(row.organization_id),accountId:String(row.account_id),legacyActorId:row.legacy_actor_id==null?null:String(row.legacy_actor_id),boundByPrincipalId:String(row.bound_by_principal_id),createdAt:String(row.created_at),updatedAt:String(row.updated_at),version:Number(row.version),classification:"BOUND" }; }
function manualDeliveryIntake(row:Row):AdminManualDeliveryIntake{return{demandId:String(row.demand_id),buyerOrganizationId:String(row.buyer_organization_id),buyerAccountId:String(row.buyer_account_id),buyerDisplayName:row.buyer_display_name==null?null:String(row.buyer_display_name),buyerEmail:row.buyer_email==null?null:String(row.buyer_email),organizationName:row.organization_name==null?null:String(row.organization_name),resourceId:String(row.resource_id),resourceTitle:String(row.resource_title),sshPublicKeyFingerprint:String(row.ssh_public_key_fingerprint),status:"PENDING_MANUAL_DELIVERY",createdAt:String(row.created_at),updatedAt:String(row.updated_at)};}
function memberCatalogPurchaseIntent(row: Row): MemberCatalogPurchaseIntent {
  const snapshot = JSON.parse(String(row.resource_snapshot_json)) as MemberCatalogPurchaseIntent["resource"];
  const quantity = Number(row.quantity);
  return {
    demandId: String(row.demand_id),
    status: "PENDING_MANUAL_DELIVERY",
    resource: snapshot,
    request: {
      quantity,
      totalGpuCount: snapshot.gpuPackageCount * quantity,
      durationHours: row.duration_hours == null ? null : Number(row.duration_hours),
      deliveryDate: row.delivery_date == null ? null : String(row.delivery_date),
    },
    pricing: {
      pricingUnit: String(row.pricing_unit),
      unitCardHourMicros: Number(row.unit_card_hour_micros),
      estimatedCardHourMicros: Number(row.estimated_card_hour_micros),
    },
    sshPublicKeyFingerprint: row.ssh_public_key_fingerprint == null ? null : String(row.ssh_public_key_fingerprint),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function purchaseResourceSnapshot(value: unknown): MemberCatalogPurchaseIntent["resource"] {
  const raw = jsonObject(value, "resourceSnapshot");
  const rawSpecs = jsonObject(raw.specs, "resourceSnapshot.specs");
  const specs = Object.fromEntries(Object.entries(rawSpecs).map(([key, item]) => [
    text(key, "resourceSnapshot.specs.key", 120),
    text(item, `resourceSnapshot.specs.${key}`, 1200),
  ]));
  return {
    id: text(raw.id, "resourceSnapshot.id", 160),
    title: text(raw.title, "resourceSnapshot.title", 300),
    supplierId: text(raw.supplierId, "resourceSnapshot.supplierId", 160),
    supplierName: text(raw.supplierName, "resourceSnapshot.supplierName", 300),
    supplierLogoUrl: optionalText(raw.supplierLogoUrl, "resourceSnapshot.supplierLogoUrl", 500),
    category: text(raw.category, "resourceSnapshot.category", 80),
    region: text(raw.region, "resourceSnapshot.region", 80),
    deliveryForm: text(raw.deliveryForm, "resourceSnapshot.deliveryForm", 80),
    summary: text(raw.summary, "resourceSnapshot.summary", 1200),
    capacity: text(raw.capacity, "resourceSnapshot.capacity", 1200),
    sla: text(raw.sla, "resourceSnapshot.sla", 1200),
    deliveryLeadTime: text(raw.deliveryLeadTime, "resourceSnapshot.deliveryLeadTime", 500),
    sourceNotice: optionalText(raw.sourceNotice, "resourceSnapshot.sourceNotice", 1200),
    gpuDescription: text(raw.gpuDescription, "resourceSnapshot.gpuDescription", 500),
    gpuPackageCount: positiveInt(raw.gpuPackageCount, "resourceSnapshot.gpuPackageCount"),
    specs,
  };
}
async function receipt<T>(db: AdminDatabaseAdapter, context: AdminMutationContext, commandType: string): Promise<T | null> { const row=await db.first<Row>("SELECT command_type,payload_hash,response_json FROM admin_command_receipts WHERE actor_principal_id=? AND idempotency_key=?",[context.principalId,context.idempotencyKey]); if (!row) return null; if (row.command_type!==commandType || row.payload_hash!==context.payloadHash) throw new ExchangeIdempotencyConflictError(); return JSON.parse(String(row.response_json)) as T; }
const auditSql = (actor:string, sourceSystem:AdminSourceSystem, entityType:string, entityId:string, action:string, why:string, digest:string, at:string):AdminSql => ({sql:"INSERT INTO admin_audit_events(id,actor_principal_id,source_system,entity_type,entity_id,action,reason,payload_digest,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)",values:[id("AAE"),actor,sourceSystem,entityType,entityId,action,why,digest,at]});
const receiptSql = (context:AdminMutationContext, command:string, response:unknown, at:string):AdminSql => ({sql:"INSERT INTO admin_command_receipts(actor_principal_id,idempotency_key,command_type,payload_hash,response_json,created_at) VALUES(?,?,?,?,?,?)",values:[context.principalId,context.idempotencyKey,command,context.payloadHash,JSON.stringify(response),at]});

const PRINCIPAL_SELECT = `SELECT a.id AS account_id,a.display_name,a.primary_email,
  m.id AS membership_id,m.organization_id,m.status AS membership_status,m.updated_at AS membership_updated_at,
  o.name AS organization_name,pm.invited_by_principal_id,pm.invited_at,pm.version AS management_version,pm.updated_at AS management_updated_at
  FROM admin_memberships m
  JOIN admin_user_accounts a ON a.id=m.account_id
  JOIN admin_organizations o ON o.id=m.organization_id
  LEFT JOIN admin_principal_management pm ON pm.membership_id=m.id`;

async function principalRecord(db:AdminDatabaseAdapter,row:Row){
  const membershipId=String(row.membership_id);
  const roleRows=await db.all<{role:string}>(`SELECT role FROM admin_membership_roles WHERE membership_id=?
    UNION ALL SELECT 'ROOT' AS role FROM admin_root_membership WHERE membership_id=? ORDER BY role`,[membershipId,membershipId]);
  const assigned=roles(roleRows.map((item)=>item.role));
  return {
    id:String(row.account_id),membershipId,displayName:String(row.display_name),primaryEmail:row.primary_email==null?null:String(row.primary_email),
    organizationId:String(row.organization_id),organizationName:String(row.organization_name),status:String(row.membership_status),
    roles:assigned,permissions:adminPermissionsForRoles(assigned),version:Number(row.management_version??0),
    invitedByPrincipalId:row.invited_by_principal_id==null?null:String(row.invited_by_principal_id),invitedAt:row.invited_at==null?null:String(row.invited_at),
    updatedAt:String(row.management_updated_at??row.membership_updated_at),source:"IDENTITY_FACTS",
  };
}

async function findPrincipal(db:AdminDatabaseAdapter,accountId:string,organizationId:string){
  const row=await db.first<Row>(`${PRINCIPAL_SELECT} WHERE a.id=? AND m.organization_id=? AND (pm.membership_id IS NOT NULL OR EXISTS (SELECT 1 FROM admin_membership_roles r WHERE r.membership_id=m.id) OR EXISTS (SELECT 1 FROM admin_root_membership root WHERE root.membership_id=m.id))`,[accountId,organizationId]);
  if(!row)throw new ExchangeDomainError("EXCHANGE_NOT_FOUND",404,"Administrator principal not found.");
  return {row,record:await principalRecord(db,row)};
}

async function ensureRootContinuity(db:AdminDatabaseAdapter,membershipId:string,nextStatus:string){
  if(nextStatus==="ACTIVE")return;
  const root=await db.first<{present:number}>("SELECT 1 AS present FROM admin_root_membership WHERE membership_id=? LIMIT 1",[membershipId]);
  if(root)throw new ExchangeDomainError("ADMIN_ROOT_IMMUTABLE",409,"The unique ROOT account cannot be suspended, removed, or transferred.");
}

function managementVersionWrite(row:Row,context:AdminMutationContext,at:string):AdminSql[]{
  const membershipId=String(row.membership_id),current=Number(row.management_version??0);
  if(current===0)return [{sql:"INSERT INTO admin_principal_management(membership_id,invited_by_principal_id,invited_at,updated_by_principal_id,version,updated_at) VALUES(?,NULL,NULL,?,1,?)",values:[membershipId,context.principalId,at]}];
  return [
    {sql:"UPDATE admin_principal_management SET updated_by_principal_id=?,version=version+1,updated_at=? WHERE membership_id=? AND version=?",values:[context.principalId,at,membershipId,current]},
    {sql:"SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END"},
  ];
}

function guardedMembershipStatusWrite(membershipId:string,status:"ACTIVE"|"SUSPENDED",at:string):AdminSql[]{
  return [
    {sql:`UPDATE admin_memberships SET status=?,updated_at=? WHERE id=? AND (
      ?='ACTIVE' OR status<>'ACTIVE'
      OR NOT EXISTS (SELECT 1 FROM admin_root_membership root WHERE root.membership_id=admin_memberships.id)
    )`,values:[status,at,membershipId,status]},
    {sql:"SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END"},
  ];
}

function roleAssignmentWrites(membershipId:string,nextRoles:readonly AdminRole[],context:AdminMutationContext,at:string):AdminSql[]{
  return [
    {sql:"DELETE FROM admin_membership_roles WHERE membership_id=?",values:[membershipId]},
    ...nextRoles.map((role)=>({sql:"INSERT INTO admin_membership_roles(membership_id,role,granted_at,granted_by) VALUES(?,?,?,?)",values:[membershipId,role,at,context.principalId]})),
  ];
}

async function translateContinuityFailure(db:AdminDatabaseAdapter,membershipId:string,nextStatus:string,error:unknown):Promise<never>{
  await ensureRootContinuity(db,membershipId,nextStatus);
  throw error;
}

export async function createAdminOperationsStore(db: AdminDatabaseAdapter): Promise<AdminOperationsStore> {
  await db.ensureSchema([...adminIdentitySchemaStatements,...adminOperationsSchemaStatements], ADMIN_OPERATIONS_SCHEMA_VERSION);
  const store: AdminOperationsStore = {
    async readProjection(name, query={}) { return readAdminProjection(db,name,query); },
    async search(query={}) { const lists=await Promise.all(ADMIN_PROJECTION_NAMES.map((name)=>readAdminProjection(db,name,{...query,limit:Math.min(limit(query),25)}))); return lists.flat().sort((a,b)=>String(b.updatedAt??b.createdAt??"").localeCompare(String(a.updatedAt??a.createdAt??""))).slice(0,limit(query)); },
    async dashboard() {
      const [entries, open, refunds, criticalExceptions] = await Promise.all([
        Promise.all(ADMIN_PROJECTION_NAMES.map(async (name) => [
          name,
          await countAdminProjection(db, name),
        ] as const)),
        db.first<{count:number}>("SELECT COUNT(*) count FROM admin_work_items WHERE status IN ('OPEN','CLAIMED','WAITING')"),
        db.first<{count:number}>("SELECT COUNT(*) count FROM admin_approvals WHERE approval_type='REFUND' AND status='PENDING'"),
        readAdminProjection(db, "exceptions", { limit: 6 }),
      ]);
      return {
        sourceSystems: ["MARKETPLACE", "EXCHANGE", "SUPPLY_PILOT", "ADMIN"],
        counts: Object.fromEntries(entries),
        openWorkItems: Number(open?.count ?? 0),
        pendingRefundApprovals: Number(refunds?.count ?? 0),
        criticalExceptions,
        generatedAt: now(),
      };
    },
    async listWorkItems(query={}) { const where:string[]=[]; const values:unknown[]=[]; if(query.status){where.push("status=?");values.push(query.status);} if(query.sourceSystem){where.push("source_system=?");values.push(query.sourceSystem);} values.push(limit(query)); return (await db.all<Row>(`SELECT * FROM admin_work_items ${where.length?`WHERE ${where.join(" AND ")}`:""} ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,due_at,created_at DESC LIMIT ?`,values)).map(workItem); },
    async createWorkItem(context,input) { const replay=await receipt<{record:AdminWorkItem}>(db,context,"CREATE_WORK_ITEM"); if(replay)return {...replay,replayed:true}; const at=now(), record:AdminWorkItem={id:id("AWI"),sourceSystem:source(input.sourceSystem),entityType:text(input.entityType,"entityType"),entityId:text(input.entityId,"entityId"),workType:text(input.workType,"workType"),title:text(input.title,"title",160),summary:text(input.summary,"summary",1000),status:"OPEN",priority:(input.priority??"NORMAL") as AdminWorkItem["priority"],assigneePrincipalId:optionalText(input.assigneePrincipalId,"assigneePrincipalId"),dueAt:optionalText(input.dueAt,"dueAt"),metadata:jsonObject(input.metadata,"metadata"),createdBy:context.principalId,version:1,createdAt:at,updatedAt:at}; if(!["LOW","NORMAL","HIGH","CRITICAL"].includes(record.priority))throw new ExchangeInputError("Unsupported priority.","priority"); const response={record}; await db.batch([{sql:"INSERT INTO admin_work_items(id,source_system,entity_type,entity_id,work_type,title,summary,status,priority,assignee_principal_id,due_at,metadata_json,created_by,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",values:[record.id,record.sourceSystem,record.entityType,record.entityId,record.workType,record.title,record.summary,record.status,record.priority,record.assigneePrincipalId,record.dueAt,JSON.stringify(record.metadata),record.createdBy,1,at,at]},auditSql(context.principalId,record.sourceSystem,record.entityType,record.entityId,"WORK_ITEM_CREATED",record.summary,context.payloadHash,at),receiptSql(context,"CREATE_WORK_ITEM",response,at)]); return {...response,replayed:false}; },
    async updateWorkItem(workId,context,input) { const replay=await receipt<{record:AdminWorkItem}>(db,context,"UPDATE_WORK_ITEM"); if(replay)return {...replay,replayed:true}; const currentRow=await db.first<Row>("SELECT * FROM admin_work_items WHERE id=?",[workId]); if(!currentRow)throw new ExchangeDomainError("EXCHANGE_NOT_FOUND",404,"Admin work item not found."); const current=workItem(currentRow), expected=positiveInt(input.expectedVersion,"expectedVersion"); if(current.version!==expected)throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT",409,"Admin work item version changed."); const status=(input.status??current.status) as AdminWorkItem["status"],priority=(input.priority??current.priority) as AdminWorkItem["priority"]; if(!["OPEN","CLAIMED","WAITING","RESOLVED","CANCELLED"].includes(status))throw new ExchangeInputError("Unsupported status.","status"); if(!["LOW","NORMAL","HIGH","CRITICAL"].includes(priority))throw new ExchangeInputError("Unsupported priority.","priority"); const why=reason(input.reason),at=now(); const record={...current,status,priority,assigneePrincipalId:input.assigneePrincipalId===undefined?current.assigneePrincipalId:optionalText(input.assigneePrincipalId,"assigneePrincipalId"),dueAt:input.dueAt===undefined?current.dueAt:optionalText(input.dueAt,"dueAt"),version:current.version+1,updatedAt:at}; const response={record}; await db.batch([{sql:"UPDATE admin_work_items SET status=?,priority=?,assignee_principal_id=?,due_at=?,version=version+1,updated_at=? WHERE id=? AND version=?",values:[record.status,record.priority,record.assigneePrincipalId,record.dueAt,at,workId,expected]},{sql:"SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END"},auditSql(context.principalId,current.sourceSystem,current.entityType,current.entityId,"WORK_ITEM_UPDATED",why,context.payloadHash,at),receiptSql(context,"UPDATE_WORK_ITEM",response,at)]); return {...response,replayed:false}; },
    async listRefundCases(query={}) { const values:unknown[]=[]; let where="approval_type='REFUND'"; if(query.status){where+=" AND status=?";values.push(query.status);} values.push(limit(query)); const rows=await db.all<Row>(`SELECT * FROM admin_approvals WHERE ${where} ORDER BY created_at DESC LIMIT ?`,values); return Promise.all(rows.map(async(row)=>{const executionRow=await db.first<Row>("SELECT * FROM admin_refund_executions WHERE refund_case_id=?",[row.id]);return refund(row,executionRow?refundExecution(executionRow):null);})); },
    async requestRefund(context,input) { const replay=await receipt<{record:AdminRefundCase}>(db,context,"REQUEST_REFUND"); if(replay)return {...replay,replayed:true}; const at=now(),why=reason(input.reason),src=source(input.sourceSystem,["EXCHANGE","SUPPLY_PILOT"]) as AdminRefundCase["sourceSystem"],entityType=text(input.entityType,"entityType"),entityId=text(input.entityId,"entityId"),amountCents=positiveInt(input.amountCents,"amountCents"),businessExpectedVersion=positiveInt(input.expectedVersion,"expectedVersion"); let business:Row|null=null; if(src==="EXCHANGE"&&entityType==="PAYMENT_INTENT")business=await db.first<Row>("SELECT amount_cents,currency,version,status FROM exchange_payment_intents WHERE id=?",[entityId]); else if(src==="SUPPLY_PILOT"&&entityType==="PAYMENT")business=await db.first<Row>("SELECT o.amount_cents,o.currency,p.version,p.status FROM supply_trial_payments p JOIN supply_trial_orders o ON o.id=p.order_id WHERE p.order_id=?",[entityId]); else throw new ExchangeInputError("Refunds must reference an EXCHANGE PAYMENT_INTENT or SUPPLY_PILOT PAYMENT.","entityType"); if(!business)throw new ExchangeDomainError("EXCHANGE_NOT_FOUND",404,"Referenced payment was not found."); if(Number(business.version)!==businessExpectedVersion)throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT",409,"Referenced payment version changed."); if(!["CAPTURED","REFUND_PENDING"].includes(String(business.status)))throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT",409,"Referenced payment is not refundable."); if(String(business.currency)!=="CNY"||amountCents>Number(business.amount_cents))throw new ExchangeDomainError("EXCHANGE_AMOUNT_TOO_LARGE",422,"Refund amount exceeds the referenced payment."); const record:AdminRefundCase={id:id("ARF"),sourceSystem:src,entityType,entityId,amountCents,currency:"CNY",businessExpectedVersion,status:"PENDING",requestedBy:context.principalId,requestReason:why,decidedBy:null,decisionReason:null,version:1,createdAt:at,updatedAt:at,decidedAt:null,execution:null}; const response={record}; await db.batch([{sql:"INSERT INTO admin_approvals(id,approval_type,source_system,entity_type,entity_id,amount_cents,currency,business_expected_version,status,requested_by,request_reason,version,created_at,updated_at) VALUES(?,'REFUND',?,?,?,?,'CNY',?,'PENDING',?,?,1,?,?)",values:[record.id,record.sourceSystem,record.entityType,record.entityId,record.amountCents,record.businessExpectedVersion,record.requestedBy,record.requestReason,at,at]},auditSql(context.principalId,src,record.entityType,record.entityId,"REFUND_REQUESTED",why,context.payloadHash,at),receiptSql(context,"REQUEST_REFUND",response,at)]); return {...response,replayed:false}; },
    async decideRefund(caseId,context,input) { const replay=await receipt<{record:AdminRefundCase}>(db,context,"DECIDE_REFUND"); if(replay)return {...replay,replayed:true}; const row=await db.first<Row>("SELECT * FROM admin_approvals WHERE id=? AND approval_type='REFUND'",[caseId]); if(!row)throw new ExchangeDomainError("EXCHANGE_NOT_FOUND",404,"Refund case not found."); const current=refund(row),expected=positiveInt(input.expectedVersion,"expectedVersion"); if(current.requestedBy===context.principalId)throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN",403,"Refund requester cannot approve their own request."); if(current.status!=="PENDING")throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT",409,"Refund case is no longer pending."); if(current.version!==expected)throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT",409,"Refund case version changed."); const decision=input.decision; if(decision!=="APPROVED"&&decision!=="REJECTED")throw new ExchangeInputError("decision must be APPROVED or REJECTED.","decision"); const why=reason(input.reason),at=now(); const record:AdminRefundCase={...current,status:decision,decidedBy:context.principalId,decisionReason:why,version:current.version+1,updatedAt:at,decidedAt:at}; const response={record}; await db.batch([{sql:"UPDATE admin_approvals SET status=?,decided_by=?,decision_reason=?,version=version+1,updated_at=?,decided_at=? WHERE id=? AND version=? AND status='PENDING' AND requested_by<>?",values:[decision,context.principalId,why,at,at,caseId,expected,context.principalId]},{sql:"SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END"},auditSql(context.principalId,current.sourceSystem,current.entityType,current.entityId,`REFUND_${decision}`,why,context.payloadHash,at),receiptSql(context,"DECIDE_REFUND",response,at)]); return {...response,replayed:false}; },
    async getRefundCase(caseId) { const row=await db.first<Row>("SELECT * FROM admin_approvals WHERE id=? AND approval_type='REFUND'",[caseId]); if(!row)return null; const executionRow=await db.first<Row>("SELECT * FROM admin_refund_executions WHERE refund_case_id=?",[caseId]); return refund(row,executionRow?refundExecution(executionRow):null); },
    async beginRefundExecution(caseId,context,executionReason) {
      const current=await store.getRefundCase(caseId);
      if(!current)throw new ExchangeDomainError("EXCHANGE_NOT_FOUND",404,"Refund case not found.");
      if(current.status!=="APPROVED")throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT",409,"Refund case has not been approved.");
      if(current.requestedBy===context.principalId)throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN",403,"Refund requester cannot execute their own request.");
      if(current.execution?.status==="SUCCEEDED")return {record:current,claimed:false};
      const why=reason(executionReason),at=now(),claimToken=id("RFC"),refundRequestId=`KAI-RF-${caseId.replaceAll(/[^A-Za-z0-9_-]/gu,"")}`.slice(0,64);
      let result:AdminRunResult;
      if(!current.execution){
        [result]=await db.batch([{sql:"INSERT INTO admin_refund_executions(refund_case_id,provider,refund_request_id,order_id,status,attempt_count,attempted_by,claim_token,last_attempt_at,version,created_at,updated_at) VALUES(?,'ALIPAY',?,?,'PROCESSING',1,?,?,?,1,?,?) ON CONFLICT DO NOTHING",values:[caseId,refundRequestId,current.entityId,context.principalId,claimToken,at,at,at]}]);
      }else{
        const staleBefore=new Date(Date.now()-5*60_000).toISOString();
        [result]=await db.batch([{sql:"UPDATE OR IGNORE admin_refund_executions SET status='PROCESSING',attempt_count=attempt_count+1,attempted_by=?,claim_token=?,last_error_code=NULL,last_error_message=NULL,last_attempt_at=?,completed_at=NULL,version=version+1,updated_at=? WHERE refund_case_id=? AND version=? AND (status='FAILED' OR (status='PROCESSING' AND last_attempt_at<?))",values:[context.principalId,claimToken,at,at,caseId,current.execution.version,staleBefore]}]);
      }
      const record=await store.getRefundCase(caseId);
      if(!record)throw new Error("ADMIN_REFUND_CASE_MISSING");
      const claimed=result.changes===1&&record.execution?.claimToken===claimToken;
      if(claimed)await db.batch([auditSql(context.principalId,current.sourceSystem,current.entityType,current.entityId,"REFUND_EXECUTION_STARTED",why,context.payloadHash,at)]);
      return {record,claimed};
    },
    async finishRefundExecution(caseId,context,input) {
      const current=await store.getRefundCase(caseId);
      if(!current?.execution)throw new ExchangeDomainError("EXCHANGE_NOT_FOUND",404,"Refund execution not found.");
      if(current.execution.status!=="PROCESSING"||current.execution.claimToken!==input.claimToken)throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT",409,"Refund execution claim is no longer active.");
      const at=now(),status=input.status,errorCode=input.status==="FAILED"?optionalText(input.errorCode,"errorCode",100):null,errorMessage=input.status==="FAILED"?optionalText(input.errorMessage,"errorMessage",1000):null,providerTransactionRef=optionalText(input.providerTransactionRef,"providerTransactionRef",200);
      await db.batch([{sql:"UPDATE admin_refund_executions SET status=?,provider_transaction_ref=?,last_error_code=?,last_error_message=?,completed_at=?,version=version+1,updated_at=? WHERE refund_case_id=? AND version=? AND status='PROCESSING' AND claim_token=?",values:[status,providerTransactionRef,errorCode,errorMessage,at,at,caseId,current.execution.version,input.claimToken]},{sql:"SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END"},auditSql(context.principalId,current.sourceSystem,current.entityType,current.entityId,status==="SUCCEEDED"?"REFUND_EXECUTION_SUCCEEDED":"REFUND_EXECUTION_FAILED",status==="SUCCEEDED"?"Approved refund completed at the payment provider.":`Approved refund failed: ${errorCode??"UNKNOWN"}.`,context.payloadHash,at)]);
      const record=await store.getRefundCase(caseId);if(!record)throw new Error("ADMIN_REFUND_CASE_MISSING");return {record};
    },
    async listPrincipals(query={}) {
      const where=["(pm.membership_id IS NOT NULL OR EXISTS (SELECT 1 FROM admin_membership_roles r WHERE r.membership_id=m.id) OR EXISTS (SELECT 1 FROM admin_root_membership root WHERE root.membership_id=m.id))"],values:unknown[]=[];
      if(query.status){where.push("m.status=?");values.push(query.status);}
      if(query.q){where.push("(a.display_name LIKE ? OR a.primary_email LIKE ? OR a.id LIKE ?)");const q=`%${query.q}%`;values.push(q,q,q);}
      values.push(limit(query));
      const rows=await db.all<Row>(`${PRINCIPAL_SELECT} WHERE ${where.join(" AND ")} ORDER BY a.display_name,a.id LIMIT ?`,values);
      return Promise.all(rows.map((row)=>principalRecord(db,row)));
    },
    async listRoles(query={}) {
      const q=query.q?.trim().toLowerCase();
      return ADMIN_ROLES.map((code)=>({code,name:code,description:ROLE_DESCRIPTIONS[code],status:"ACTIVE",assignable:code!=="ROOT",permissions:adminPermissionsForRoles([code]),version:1,source:"AUTHORIZATION_POLICY"}))
        .filter((item)=>!q||item.code.toLowerCase().includes(q)||item.description.toLowerCase().includes(q)).slice(0,limit(query));
    },
    async invitePrincipal(context,input) {
      const replay=await receipt<{record:Record<string,unknown>}>(db,context,"INVITE_ADMIN_PRINCIPAL");if(replay)return{...replay,replayed:true};
      const organizationId=adminOrganizationId(context),expected=nonNegativeInt(input.expectedVersion,"expectedVersion");if(expected!==0)throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT",409,"A new administrator invitation must use expectedVersion 0.");
      const normalizedEmail=email(input.email),displayName=text(input.displayName,"displayName",120),assignedRoles=assignableRoles(input.roles),why=reason(input.reason),at=now();
      if(!assignedRoles.length)throw new ExchangeInputError("roles must contain at least one administrator role.","roles");
      const organization=await db.first<Row>("SELECT id,name,status FROM admin_organizations WHERE id=?",[organizationId]);
      if(!organization||organization.status!=="ACTIVE")throw new ExchangeDomainError("ADMIN_ORGANIZATION_UNAVAILABLE",409,"The administrator organization is not active.");
      const subject=await digestHex(normalizedEmail);
      const existingIdentity=await db.first<Row>("SELECT id,account_id FROM admin_account_identities WHERE provider='EMAIL' AND tenant_key='EXTERNAL' AND provider_subject=?",[subject]);
      const existingAccount=existingIdentity?await db.first<Row>("SELECT id,status FROM admin_user_accounts WHERE id=?",[existingIdentity.account_id]):await db.first<Row>("SELECT id,status FROM admin_user_accounts WHERE primary_email=?",[normalizedEmail]);
      if(existingAccount&&existingAccount.status!=="ACTIVE")throw new ExchangeDomainError("ADMIN_ACCOUNT_SUSPENDED",409,"The invited account is suspended.");
      const accountId=existingAccount?String(existingAccount.id):await digestId("acct",`EMAIL:EXTERNAL:${subject}`);
      const membershipId=await digestId("mbr",`${accountId}:${organizationId}`);
      const identityId=existingIdentity?String(existingIdentity.id):await digestId("ident",`EMAIL:EXTERNAL:${subject}`);
      const occupied=await db.first<Row>(`SELECT m.id FROM admin_memberships m LEFT JOIN admin_principal_management pm ON pm.membership_id=m.id
        WHERE m.id=? AND (pm.membership_id IS NOT NULL OR EXISTS (SELECT 1 FROM admin_membership_roles r WHERE r.membership_id=m.id) OR EXISTS (SELECT 1 FROM admin_root_membership root WHERE root.membership_id=m.id))`,[membershipId]);
      if(occupied)throw new ExchangeDomainError("ADMIN_PRINCIPAL_EXISTS",409,"This administrator has already been invited.");
      const record={id:accountId,membershipId,displayName,primaryEmail:normalizedEmail,organizationId,organizationName:String(organization.name),status:"ACTIVE",roles:assignedRoles,permissions:adminPermissionsForRoles(assignedRoles),version:1,invitedByPrincipalId:context.principalId,invitedAt:at,updatedAt:at,source:"IDENTITY_FACTS"};
      const response={record};
      const statements:AdminSql[]=[
        {sql:"INSERT OR IGNORE INTO admin_user_accounts(id,display_name,primary_email,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)",values:[accountId,displayName,normalizedEmail,at,at]},
        {sql:"INSERT OR IGNORE INTO admin_memberships(id,account_id,organization_id,status,created_at,updated_at) VALUES(?,?,?,'PENDING',?,?)",values:[membershipId,accountId,organizationId,at,at]},
        existingIdentity?{sql:"UPDATE admin_account_identities SET organization_id=? WHERE id=?",values:[organizationId,identityId]}:{sql:"INSERT INTO admin_account_identities(id,account_id,organization_id,provider,tenant_key,provider_subject,normalized_email,verified_at,created_at) VALUES(?,?,?,'EMAIL','EXTERNAL',?,?,?,?)",values:[identityId,accountId,organizationId,subject,normalizedEmail,at,at]},
        {sql:"UPDATE admin_memberships SET status='ACTIVE',updated_at=? WHERE id=?",values:[at,membershipId]},
        {sql:"DELETE FROM admin_membership_roles WHERE membership_id=?",values:[membershipId]},
        ...assignedRoles.map((role)=>({sql:"INSERT INTO admin_membership_roles(membership_id,role,granted_at,granted_by) VALUES(?,?,?,?)",values:[membershipId,role,at,context.principalId]})),
        {sql:"INSERT INTO admin_principal_management(membership_id,invited_by_principal_id,invited_at,updated_by_principal_id,version,updated_at) VALUES(?,?,?,?,1,?)",values:[membershipId,context.principalId,at,context.principalId,at]},
        auditSql(context.principalId,"ADMIN","ADMIN_PRINCIPAL",accountId,"ADMIN_PRINCIPAL_INVITED",why,context.payloadHash,at),receiptSql(context,"INVITE_ADMIN_PRINCIPAL",response,at),
      ];
      await db.batch(statements);return{...response,replayed:false};
    },
    async updatePrincipalStatus(accountIdValue,context,input) {
      const accountId=text(accountIdValue,"accountId"),command=`UPDATE_ADMIN_PRINCIPAL_STATUS:${accountId}`,replay=await receipt<{record:Record<string,unknown>}>(db,context,command);if(replay)return{...replay,replayed:true};
      const organizationId=adminOrganizationId(context),found=await findPrincipal(db,accountId,organizationId),expected=nonNegativeInt(input.expectedVersion,"expectedVersion");
      if(Number(found.record.version)!==expected)throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT",409,"Administrator principal version changed.");
      const status=input.status;if(status!=="ACTIVE"&&status!=="SUSPENDED")throw new ExchangeInputError("status must be ACTIVE or SUSPENDED.","status");
      const why=reason(input.reason),at=now();await ensureRootContinuity(db,String(found.row.membership_id),status);
      const record={...found.record,status,version:expected+1,updatedAt:at};const response={record};
      try{await db.batch([...managementVersionWrite(found.row,context,at),...guardedMembershipStatusWrite(String(found.row.membership_id),status,at),auditSql(context.principalId,"ADMIN","ADMIN_PRINCIPAL",accountId,`ADMIN_PRINCIPAL_${status}`,why,context.payloadHash,at),receiptSql(context,command,response,at)]);}catch(error){return translateContinuityFailure(db,String(found.row.membership_id),status,error);}
      return{...response,replayed:false};
    },
    async assignPrincipalRoles(accountIdValue,context,input) {
      const accountId=text(accountIdValue,"accountId"),command=`ASSIGN_ADMIN_PRINCIPAL_ROLES:${accountId}`,replay=await receipt<{record:Record<string,unknown>}>(db,context,command);if(replay)return{...replay,replayed:true};
      const organizationId=adminOrganizationId(context),found=await findPrincipal(db,accountId,organizationId),expected=nonNegativeInt(input.expectedVersion,"expectedVersion");
      if(Number(found.record.version)!==expected)throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT",409,"Administrator principal version changed.");
      const assignedRoles=assignableRoles(input.roles),why=reason(input.reason),at=now(),membershipId=String(found.row.membership_id);
      const effectiveRoles=(found.record.roles as AdminRole[]).includes("ROOT")?["ROOT",...assignedRoles] as AdminRole[]:assignedRoles;
      const record={...found.record,roles:effectiveRoles,permissions:adminPermissionsForRoles(effectiveRoles),version:expected+1,updatedAt:at};const response={record};
      await db.batch([...managementVersionWrite(found.row,context,at),...roleAssignmentWrites(membershipId,assignedRoles,context,at),{sql:"UPDATE admin_memberships SET updated_at=? WHERE id=?",values:[at,membershipId]},auditSql(context.principalId,"ADMIN","ADMIN_PRINCIPAL",accountId,"ADMIN_PRINCIPAL_ROLES_ASSIGNED",why,context.payloadHash,at),receiptSql(context,command,response,at)]);
      return{...response,replayed:false};
    },
    async listAuditEvents(query={}) { const values:unknown[]=[]; let where=""; if(query.sourceSystem){where="WHERE source_system=?";values.push(query.sourceSystem);} values.push(limit(query)); return (await db.all<Row>(`SELECT * FROM admin_audit_events ${where} ORDER BY occurred_at DESC LIMIT ?`,values)).map(r=>({id:String(r.id),actorPrincipalId:String(r.actor_principal_id),sourceSystem:r.source_system,entityType:String(r.entity_type),entityId:String(r.entity_id),action:String(r.action),reason:String(r.reason),payloadDigest:String(r.payload_digest),occurredAt:String(r.occurred_at)})); },
    async bindEntityOrganization(context,input) { const replay=await receipt<{record:AdminEntityOwnership}>(db,context,"BIND_ENTITY_ORGANIZATION"); if(replay)return {...replay,replayed:true}; const src=source(input.sourceSystem),entityType=text(input.entityType,"entityType"),entityId=text(input.entityId,"entityId"),organizationId=text(input.organizationId,"organizationId"),accountId=text(input.accountId,"accountId"),legacyActorId=optionalText(input.legacyActorId,"legacyActorId"),why=reason(input.reason),expected=nonNegativeInt(input.expectedVersion,"expectedVersion"),at=now(); const existing=await store.getEntityOwnership(src,entityType,entityId); if(existing && expected!==existing.version)throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT",409,"Ownership binding version changed."); if(!existing && expected!==0)throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT",409,"Ownership binding does not exist."); const record:AdminEntityOwnership={sourceSystem:src,entityType,entityId,organizationId,accountId,legacyActorId,boundByPrincipalId:context.principalId,createdAt:existing?.createdAt??at,updatedAt:at,version:(existing?.version??0)+1,classification:"BOUND"}; const response={record}; const write=existing?{sql:"UPDATE admin_entity_ownership SET organization_id=?,account_id=?,legacy_actor_id=?,bound_by_principal_id=?,updated_at=?,version=version+1 WHERE source_system=? AND entity_type=? AND entity_id=? AND version=?",values:[organizationId,accountId,legacyActorId,context.principalId,at,src,entityType,entityId,existing.version]}:{sql:"INSERT INTO admin_entity_ownership(source_system,entity_type,entity_id,organization_id,account_id,legacy_actor_id,bound_by_principal_id,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,1)",values:[src,entityType,entityId,organizationId,accountId,legacyActorId,context.principalId,at,at]}; await db.batch([write,{sql:"SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END"},auditSql(context.principalId,src,entityType,entityId,"ENTITY_OWNERSHIP_BOUND",why,context.payloadHash,at),receiptSql(context,"BIND_ENTITY_ORGANIZATION",response,at)]); return {...response,replayed:false}; },
    async getEntityOwnership(src,entityType,entityId) { const row=await db.first<Row>("SELECT * FROM admin_entity_ownership WHERE source_system=? AND entity_type=? AND entity_id=?",[src,entityType,entityId]); return row?ownership(row):null; },
    async recordManualDeliveryIntake(context,input) {
      const command="RECORD_MANUAL_DELIVERY_INTAKE";
      const replay=await receipt<{record:AdminManualDeliveryIntake}>(db,context,command);
      if(replay)return{...replay,replayed:true};
      const demandId=text(input.demandId,"demandId",160),organizationId=adminOrganizationId(context),accountId=text(input.buyerAccountId,"buyerAccountId",160),resourceId=text(input.resourceId,"resourceId",160),resourceTitle=text(input.resourceTitle,"resourceTitle",300),canonicalKey=text(input.canonicalSshPublicKey,"canonicalSshPublicKey",12288),fingerprint=text(input.sshPublicKeyFingerprint,"sshPublicKeyFingerprint",160),at=now();
      if(!/^(?:ssh-ed25519|ssh-rsa) [A-Za-z0-9+/]+={0,2}$/u.test(canonicalKey))throw new ExchangeInputError("canonicalSshPublicKey must be a canonical OpenSSH public key.","canonicalSshPublicKey");
      if(!/^SHA256:[A-Za-z0-9+/]{43}$/u.test(fingerprint))throw new ExchangeInputError("sshPublicKeyFingerprint is invalid.","sshPublicKeyFingerprint");
      const existing=await db.first<Row>("SELECT i.*,a.display_name buyer_display_name,a.primary_email buyer_email,o.name organization_name FROM admin_manual_delivery_intakes i LEFT JOIN admin_user_accounts a ON a.id=i.buyer_account_id LEFT JOIN admin_organizations o ON o.id=i.buyer_organization_id WHERE i.demand_id=?",[demandId]);
      if(existing){if(String(existing.ssh_public_key_fingerprint)!==fingerprint||String(existing.buyer_organization_id)!==organizationId||String(existing.buyer_account_id)!==accountId)throw new ExchangeIdempotencyConflictError();return{record:manualDeliveryIntake(existing),replayed:true};}
      const record:AdminManualDeliveryIntake={demandId,buyerOrganizationId:organizationId,buyerAccountId:accountId,buyerDisplayName:null,buyerEmail:null,organizationName:null,resourceId,resourceTitle,sshPublicKeyFingerprint:fingerprint,status:"PENDING_MANUAL_DELIVERY",createdAt:at,updatedAt:at};
      const response={record};
      await db.batch([{sql:"INSERT INTO admin_manual_delivery_intakes(demand_id,buyer_organization_id,buyer_account_id,resource_id,resource_title,canonical_ssh_public_key,ssh_public_key_fingerprint,status,idempotency_key,payload_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'PENDING_MANUAL_DELIVERY',?,?,?,?)",values:[demandId,organizationId,accountId,resourceId,resourceTitle,canonicalKey,fingerprint,context.idempotencyKey,context.payloadHash,at,at]},auditSql(context.principalId,"MARKETPLACE","MANUAL_DELIVERY_INTAKE",demandId,"MANUAL_DELIVERY_INTAKE_RECORDED","Buyer SSH public key fingerprint recorded for manual fulfillment.",context.payloadHash,at),receiptSql(context,command,response,at)]);
      return{record,replayed:false};
    },
    async listManualDeliveryIntakes(query={}) {
      const values:unknown[]=[];let where="";if(query.status){where="WHERE i.status=?";values.push(query.status);}values.push(limit(query));
      return(await db.all<Row>(`SELECT i.*,a.display_name buyer_display_name,a.primary_email buyer_email,o.name organization_name FROM admin_manual_delivery_intakes i LEFT JOIN admin_user_accounts a ON a.id=i.buyer_account_id LEFT JOIN admin_organizations o ON o.id=i.buyer_organization_id ${where} ORDER BY i.created_at DESC LIMIT ?`,values)).map(manualDeliveryIntake);
    },
    async revealManualDeliveryPublicKey(principalIdValue,demandIdValue) {
      const principalId=text(principalIdValue,"principalId",160),demandId=text(demandIdValue,"demandId",160),row=await db.first<Row>("SELECT demand_id,canonical_ssh_public_key,ssh_public_key_fingerprint FROM admin_manual_delivery_intakes WHERE demand_id=?",[demandId]);
      if(!row)throw new ExchangeDomainError("EXCHANGE_NOT_FOUND",404,"Manual delivery intake not found.");
      const at=now(),digest=await digestHex(`${principalId}:${demandId}:${String(row.ssh_public_key_fingerprint)}:${at}`);
      await db.batch([auditSql(principalId,"MARKETPLACE","MANUAL_DELIVERY_INTAKE",demandId,"MANUAL_DELIVERY_KEY_REVEALED","Authorized fulfillment operator revealed a buyer public key for manual delivery.",digest,at)]);
      return{demandId,canonicalSshPublicKey:String(row.canonical_ssh_public_key),sshPublicKeyFingerprint:String(row.ssh_public_key_fingerprint)} satisfies AdminManualDeliveryPublicKey;
    },
    async recordCatalogPurchaseIntentSnapshot(context,input) {
      const command="RECORD_CATALOG_PURCHASE_INTENT_SNAPSHOT";
      const replay=await receipt<{record:MemberCatalogPurchaseIntent}>(db,context,command);
      if(replay)return{...replay,replayed:true};
      const demandId=text(input.demandId,"demandId",160),organizationId=adminOrganizationId(context),accountId=text(input.buyerAccountId,"buyerAccountId",160);
      if(accountId!==context.principalId)throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN",403,"Purchase snapshot account must match the authenticated buyer.");
      const owner=await store.getEntityOwnership("MARKETPLACE","DEMAND",demandId);
      if(!owner||owner.organizationId!==organizationId||owner.accountId!==accountId)throw new ExchangeDomainError("EXCHANGE_NOT_FOUND",404,"Owned marketplace demand not found.");
      const resource=purchaseResourceSnapshot(input.resourceSnapshot),quantity=positiveNumber(input.quantity,"quantity"),durationHours=input.durationHours==null?null:positiveNumber(input.durationHours,"durationHours"),deliveryDate=optionalText(input.deliveryDate,"deliveryDate",64),pricingUnit=text(input.pricingUnit,"pricingUnit",80);
      const unitPriceCnyCents=positiveInt(input.unitPriceCnyCents,"unitPriceCnyCents"),unitCardHourMicros=positiveInt(input.unitCardHourMicros,"unitCardHourMicros"),estimatedCardHourMicros=positiveInt(input.estimatedCardHourMicros,"estimatedCardHourMicros");
      const fingerprint=text(input.sshPublicKeyFingerprint,"sshPublicKeyFingerprint",160);
      if(!/^SHA256:[A-Za-z0-9+/]{43}$/u.test(fingerprint))throw new ExchangeInputError("sshPublicKeyFingerprint is invalid.","sshPublicKeyFingerprint");
      const existing=await db.first<Row>(`SELECT s.*,i.ssh_public_key_fingerprint FROM admin_catalog_purchase_intent_snapshots s
        LEFT JOIN admin_manual_delivery_intakes i ON i.demand_id=s.demand_id WHERE s.demand_id=?`,[demandId]);
      if(existing){
        if(String(existing.payload_hash)!==context.payloadHash||String(existing.buyer_organization_id)!==organizationId||String(existing.buyer_account_id)!==accountId)throw new ExchangeIdempotencyConflictError();
        return{record:memberCatalogPurchaseIntent(existing),replayed:true};
      }
      const at=now(),snapshotJson=JSON.stringify(resource);
      const row:Row={demand_id:demandId,resource_snapshot_json:snapshotJson,quantity,duration_hours:durationHours,delivery_date:deliveryDate,pricing_unit:pricingUnit,unit_card_hour_micros:unitCardHourMicros,estimated_card_hour_micros:estimatedCardHourMicros,ssh_public_key_fingerprint:fingerprint,created_at:at,updated_at:at};
      const record=memberCatalogPurchaseIntent(row),response={record};
      await db.batch([
        {sql:"INSERT INTO admin_catalog_purchase_intent_snapshots(demand_id,buyer_organization_id,buyer_account_id,resource_id,resource_title,resource_snapshot_json,quantity,duration_hours,delivery_date,pricing_unit,unit_price_cny_cents,unit_card_hour_micros,estimated_card_hour_micros,status,idempotency_key,payload_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING_MANUAL_DELIVERY',?,?,?,?)",values:[demandId,organizationId,accountId,resource.id,resource.title,snapshotJson,quantity,durationHours,deliveryDate,pricingUnit,unitPriceCnyCents,unitCardHourMicros,estimatedCardHourMicros,context.idempotencyKey,context.payloadHash,at,at]},
        auditSql(context.principalId,"MARKETPLACE","CATALOG_PURCHASE_INTENT",demandId,"CATALOG_PURCHASE_INTENT_SNAPSHOT_RECORDED","Immutable catalog resource and card-hour snapshot recorded for the buyer.",context.payloadHash,at),
        receiptSql(context,command,response,at),
      ]);
      return{record,replayed:false};
    },
    async listMemberCatalogPurchaseIntents(organizationIdValue,limitValue=50) {
      const organizationId=text(organizationIdValue,"organizationId",160),rowLimit=Math.min(100,Math.max(1,Number(limitValue)||50));
      const rows=await db.all<Row>(`SELECT s.*,i.ssh_public_key_fingerprint FROM admin_catalog_purchase_intent_snapshots s
        JOIN admin_entity_ownership own ON own.source_system='MARKETPLACE' AND own.entity_type='DEMAND' AND own.entity_id=s.demand_id
        LEFT JOIN admin_manual_delivery_intakes i ON i.demand_id=s.demand_id
        WHERE own.organization_id=? AND s.buyer_organization_id=?
        ORDER BY s.created_at DESC,s.demand_id DESC LIMIT ?`,[organizationId,organizationId,rowLimit]);
      return rows.map(memberCatalogPurchaseIntent);
    },
    async getMemberCatalogPurchaseIntent(organizationIdValue,demandIdValue) {
      const organizationId=text(organizationIdValue,"organizationId",160),demandId=text(demandIdValue,"demandId",160);
      const row=await db.first<Row>(`SELECT s.*,i.ssh_public_key_fingerprint FROM admin_catalog_purchase_intent_snapshots s
        JOIN admin_entity_ownership own ON own.source_system='MARKETPLACE' AND own.entity_type='DEMAND' AND own.entity_id=s.demand_id
        LEFT JOIN admin_manual_delivery_intakes i ON i.demand_id=s.demand_id
        WHERE own.organization_id=? AND s.buyer_organization_id=? AND s.demand_id=?`,[organizationId,organizationId,demandId]);
      return row?memberCatalogPurchaseIntent(row):null;
    },
    async getMemberPersonalCounts(organizationIdValue,asOfValue) {
      const organizationId=text(organizationIdValue,"organizationId");
      const asOf=text(asOfValue,"asOf",64);
      if(Number.isNaN(Date.parse(asOf)))throw new ExchangeInputError("asOf must be a valid timestamp.","asOf");
      const row=await db.first<Record<string,number>>(`SELECT
        (SELECT COUNT(*)
          FROM marketplace_requests_v2 request
          JOIN admin_entity_ownership own
            ON own.source_system='MARKETPLACE'
            AND own.entity_type='DEMAND'
            AND own.entity_id=request.id
          WHERE own.organization_id=? AND request.request_type='procurement') purchase_requests,
        (SELECT COUNT(*)
          FROM exchange_orders exchange_order
          JOIN admin_entity_ownership own
            ON own.source_system='EXCHANGE'
            AND own.entity_type='ORDER'
            AND own.entity_id=exchange_order.id
          WHERE own.organization_id=?) orders,
        (SELECT COUNT(*)
          FROM exchange_orders exchange_order
          JOIN admin_entity_ownership own
            ON own.source_system='EXCHANGE'
            AND own.entity_type='ORDER'
            AND own.entity_id=exchange_order.id
          JOIN exchange_order_lifecycle lifecycle
            ON lifecycle.order_id=exchange_order.id
          JOIN exchange_payment_intents payment
            ON payment.order_id=exchange_order.id
          WHERE own.organization_id=?
            AND exchange_order.status='AWAITING_PAYMENT'
            AND lifecycle.phase='AWAITING_PAYMENT'
            AND payment.status='PENDING'
            AND exchange_order.hold_expires_at>?
            AND payment.expires_at>?) pending_payment,
        (SELECT COUNT(*)
          FROM exchange_orders exchange_order
          JOIN admin_entity_ownership own
            ON own.source_system='EXCHANGE'
            AND own.entity_type='ORDER'
            AND own.entity_id=exchange_order.id
          LEFT JOIN exchange_order_lifecycle lifecycle ON lifecycle.order_id=exchange_order.id
          WHERE own.organization_id=?
            AND exchange_order.status NOT IN ('CANCELLED','EXPIRED')
            AND lifecycle.phase='AWAITING_ACCEPTANCE') pending_acceptance`,[
          organizationId,organizationId,organizationId,asOf,asOf,organizationId,
        ]);
      if(!row)throw new Error("MEMBER_PERSONAL_COUNTS_UNAVAILABLE");
      const result:MemberPersonalCounts={
        purchaseRequests:Number(row.purchase_requests),
        orders:Number(row.orders),
        pendingPayment:Number(row.pending_payment),
        pendingAcceptance:Number(row.pending_acceptance),
      };
      if(Object.values(result).some((value)=>!Number.isSafeInteger(value)||value<0))throw new Error("MEMBER_PERSONAL_COUNTS_INVALID");
      return result;
    },
  };
  return store;
}
