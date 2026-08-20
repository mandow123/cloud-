import { KAI_PUBLIC_API_SCHEMA_VERSION, kaiPublicApiSchemaStatements } from "../../db/kai-public-api-schema.ts";
import { kaiPublicApiCommandSchemaStatements } from "../../db/kai-public-api-command-schema.ts";
import type { KaiPublicVerification, KaiPublicWebhookDelivery } from "../kai-public-api.ts";
import { ExchangeDomainError, ExchangeIdempotencyConflictError } from "./exchange-errors.ts";
import type { KaiPublicApiDatabaseAdapter, KaiPublicApiSql, KaiPublicApiStore, KaiPublicMutationContext } from "./public-api-store.ts";

type Row = Record<string, unknown>;
const value = (row: Row, field: string) => String(row[field] ?? "");
const nullable = (row: Row, field: string) => row[field] == null ? null : String(row[field]);
const number = (row: Row, field: string) => Number(row[field]);
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

function verification(row: Row): KaiPublicVerification {
  const failureCode = nullable(row, "failure_code");
  return {
    id: value(row, "id"),
    organizationReference: value(row, "organization_reference"),
    resourceReference: value(row, "resource_reference"),
    productCode: value(row, "product_code"),
    region: value(row, "region"),
    specifications: JSON.parse(value(row, "specifications_json")) as Record<string, unknown>,
    deviceId: nullable(row, "device_id"),
    commandId: nullable(row, "command_id"),
    version: number(row, "version"),
    status: value(row, "status") as KaiPublicVerification["status"],
    failure: failureCode ? { code: failureCode, message: nullable(row, "failure_message") ?? "Verification failed." } : null,
    createdAt: value(row, "created_at"),
    updatedAt: value(row, "updated_at"),
  };
}

function webhookPayload(record: KaiPublicVerification, occurredAt: string) {
  return {
    id: id("kaievt"),
    version: 1,
    type: "resource.verification.updated",
    occurredAt,
    data: { verification: publicVerification(record) },
  };
}

function publicVerification(record: KaiPublicVerification) {
  return {
    id: record.id,
    version: record.version,
    status: record.status,
    updatedAt: record.updatedAt,
    failure: record.failure,
  };
}

function audit(context: KaiPublicMutationContext, eventType: string, entityId: string): KaiPublicApiSql {
  return {
    sql: `INSERT INTO kai_public_api_audit_events(id,client_id,organization_id,actor_id,event_type,entity_id,payload_hash,occurred_at)
      VALUES(?,?,?,?,?,?,?,?)`,
    values: [id("kpaud"), context.clientId, context.organizationId, context.actorId, eventType, entityId, context.payloadHash, context.now],
  };
}

function outbox(clientId: string, record: KaiPublicVerification): KaiPublicApiSql {
  return {
    sql: `INSERT INTO kai_public_api_webhook_outbox(delivery_id,client_id,verification_id,event_version,payload_json,status,attempt,next_attempt_at,created_at)
      VALUES(?,?,?,?,?,'PENDING',0,?,?)`,
    values: [id("kpdel"), clientId, record.id, record.version, JSON.stringify(webhookPayload(record, record.updatedAt)), record.updatedAt, record.updatedAt],
  };
}

async function owned(db: KaiPublicApiDatabaseAdapter, clientId: string, verificationId: string) {
  const row = await db.first<Row>("SELECT * FROM kai_public_api_verifications WHERE id=? AND client_id=?", [verificationId, clientId]);
  return row ? verification(row) : null;
}

async function receipt(db: KaiPublicApiDatabaseAdapter, context: KaiPublicMutationContext) {
  return db.first<Row>("SELECT * FROM kai_public_api_command_receipts WHERE client_id=? AND idempotency_key=?", [context.clientId, context.idempotencyKey]);
}

function assertReceipt(row: Row, context: KaiPublicMutationContext, commandType: string) {
  if (value(row, "payload_hash") !== context.payloadHash || value(row, "command_type") !== commandType) throw new ExchangeIdempotencyConflictError();
}

export async function createKaiPublicApiStore(db: KaiPublicApiDatabaseAdapter): Promise<KaiPublicApiStore> {
  await db.ensureSchema([...kaiPublicApiSchemaStatements, ...kaiPublicApiCommandSchemaStatements], KAI_PUBLIC_API_SCHEMA_VERSION);
  return {
    async createVerification(context, input) {
      const existing = await db.first<Row>("SELECT * FROM kai_public_api_verifications WHERE client_id=? AND idempotency_key=?", [context.clientId, context.idempotencyKey]);
      if (existing) {
        if (value(existing, "payload_hash") !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
        return { record: verification(existing), replayed: true };
      }
      const record: KaiPublicVerification = {
        id: id("kpver"), organizationReference: context.organizationReference, resourceReference: input.resourceReference,
        productCode: input.productCode, region: input.region, specifications: input.specifications,
        deviceId: null, commandId: null, version: 1, status: "pending", failure: null,
        createdAt: context.now, updatedAt: context.now,
      };
      try {
        await db.batch([
          { sql: `INSERT INTO kai_public_api_verifications(id,client_id,organization_id,organization_reference,resource_reference,product_code,region,specifications_json,idempotency_key,payload_hash,status,version,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,'pending',1,?,?)`, values: [record.id, context.clientId, context.organizationId, context.organizationReference, input.resourceReference, input.productCode, input.region, JSON.stringify(input.specifications), context.idempotencyKey, context.payloadHash, context.now, context.now] },
          audit(context, "RESOURCE_VERIFICATION_CREATED", record.id), outbox(context.clientId, record),
        ]);
      } catch (error) {
        const raced = await db.first<Row>("SELECT * FROM kai_public_api_verifications WHERE client_id=? AND idempotency_key=?", [context.clientId, context.idempotencyKey]);
        if (raced) {
          if (value(raced, "payload_hash") !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
          return { record: verification(raced), replayed: true };
        }
        throw error;
      }
      return { record, replayed: false };
    },

    getVerification(clientId, verificationId) { return owned(db, clientId, verificationId); },

    async getCurrentVerification(clientId, resourceReference) {
      const row = await db.first<Row>("SELECT * FROM kai_public_api_verifications WHERE client_id=? AND resource_reference=? ORDER BY created_at DESC LIMIT 1", [clientId, resourceReference]);
      return row ? verification(row) : null;
    },

    async revokeVerification(context, verificationId) {
      const priorReceipt = await receipt(db, context);
      if (priorReceipt) {
        assertReceipt(priorReceipt, context, "REVOKE_VERIFICATION");
        const replayed = await owned(db, context.clientId, value(priorReceipt, "entity_id"));
        if (!replayed) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "资源验证不存在。 ");
        return { record: replayed, replayed: true };
      }
      const current = await owned(db, context.clientId, verificationId);
      if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "资源验证不存在。 ");
      const record = current.status === "revoked" ? current : { ...current, status: "revoked" as const, failure: null, version: current.version + 1, updatedAt: context.now };
      const statements: KaiPublicApiSql[] = [];
      if (current.status !== "revoked") {
        statements.push({ sql: "UPDATE kai_public_api_verifications SET status='revoked',failure_code=NULL,failure_message=NULL,version=version+1,updated_at=? WHERE id=? AND client_id=? AND version=?", values: [context.now, verificationId, context.clientId, current.version] }, outbox(context.clientId, record));
      }
      statements.push(audit(context, "RESOURCE_VERIFICATION_REVOKED", verificationId), {
        sql: "INSERT INTO kai_public_api_command_receipts(client_id,idempotency_key,command_type,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)",
        values: [context.clientId, context.idempotencyKey, "REVOKE_VERIFICATION", context.payloadHash, verificationId, context.now],
      });
      await db.batch(statements);
      return { record, replayed: false };
    },

    async bindChallenge(context, resourceReference, challengeId) {
      const existingBinding = await db.first<Row>("SELECT * FROM kai_public_api_challenge_bindings WHERE challenge_id=? AND client_id=?", [challengeId, context.clientId]);
      if (existingBinding) {
        const existing = await owned(db, context.clientId, value(existingBinding, "verification_id"));
        if (!existing || existing.resourceReference !== resourceReference) throw new ExchangeIdempotencyConflictError();
        return existing;
      }
      const current = await (this as KaiPublicApiStore).getCurrentVerification(context.clientId, resourceReference);
      if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "资源验证不存在。 ");
      if (["passed", "failed", "revoked"].includes(current.status)) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "资源验证当前不能绑定新的设备挑战。 ");
      const record = current.status === "running" ? current : { ...current, status: "running" as const, version: current.version + 1, updatedAt: context.now };
      const statements: KaiPublicApiSql[] = [{ sql: "INSERT INTO kai_public_api_challenge_bindings(challenge_id,verification_id,client_id,organization_id,resource_reference,created_at) VALUES(?,?,?,?,?,?)", values: [challengeId, current.id, context.clientId, context.organizationId, resourceReference, context.now] }];
      if (current.status !== "running") statements.push({ sql: "UPDATE kai_public_api_verifications SET status='running',version=version+1,updated_at=? WHERE id=? AND client_id=? AND version=?", values: [context.now, current.id, context.clientId, current.version] }, outbox(context.clientId, record));
      statements.push(audit(context, "AGENT_CHALLENGE_BOUND", current.id));
      await db.batch(statements);
      return record;
    },

    async getChallengeBinding(clientId, challengeId) {
      const row = await db.first<Row>("SELECT * FROM kai_public_api_challenge_bindings WHERE challenge_id=? AND client_id=?", [challengeId, clientId]);
      return row ? { verificationId: value(row, "verification_id"), resourceReference: value(row, "resource_reference"), deviceId: nullable(row, "device_id") } : null;
    },

    async bindDevice(clientId, challengeId, deviceId, now) {
      const binding = await db.first<Row>("SELECT * FROM kai_public_api_challenge_bindings WHERE challenge_id=? AND client_id=?", [challengeId, clientId]);
      if (!binding) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "Agent Challenge 不存在。 ");
      const current = await owned(db, clientId, value(binding, "verification_id"));
      if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "资源验证不存在。 ");
      const bound = nullable(binding, "device_id");
      if (bound && bound !== deviceId) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "Agent Challenge 已绑定其他设备。 ");
      await db.batch([
        { sql: "UPDATE kai_public_api_challenge_bindings SET device_id=?,registered_at=? WHERE challenge_id=? AND client_id=? AND device_id IS NULL", values: [deviceId, now, challengeId, clientId] },
        { sql: "UPDATE kai_public_api_verifications SET device_id=?,updated_at=? WHERE id=? AND client_id=? AND (device_id IS NULL OR device_id=?)", values: [deviceId, now, current.id, clientId, deviceId] },
      ]);
      return { ...current, deviceId, updatedAt: now };
    },

    async setVerificationCommand(clientId, verificationId, commandId, now) {
      const current = await owned(db, clientId, verificationId);
      if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "资源验证不存在。 ");
      if (current.commandId && current.commandId !== commandId) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "资源验证已绑定其他验证任务。 ");
      await db.batch([{ sql: "UPDATE kai_public_api_verifications SET command_id=?,updated_at=? WHERE id=? AND client_id=? AND command_id IS NULL", values: [commandId, now, verificationId, clientId] }]);
      return { ...current, commandId, updatedAt: now };
    },

    async syncVerification(clientId, deviceId, status, failure, now) {
      const row = await db.first<Row>("SELECT * FROM kai_public_api_verifications WHERE client_id=? AND device_id=? ORDER BY created_at DESC LIMIT 1", [clientId, deviceId]);
      if (!row) return null;
      const current = verification(row);
      if (current.status === "revoked") return current;
      if (current.status === status && JSON.stringify(current.failure) === JSON.stringify(failure)) return current;
      const record = { ...current, status, failure, version: current.version + 1, updatedAt: now };
      await db.batch([
        { sql: "UPDATE kai_public_api_verifications SET status=?,failure_code=?,failure_message=?,version=version+1,updated_at=? WHERE id=? AND client_id=? AND version=?", values: [status, failure?.code ?? null, failure?.message ?? null, now, current.id, clientId, current.version] },
        outbox(clientId, record),
      ]);
      return record;
    },

    async nextWebhook(now) {
      const row = await db.first<Row>("SELECT * FROM kai_public_api_webhook_outbox WHERE status='PENDING' AND next_attempt_at<=? ORDER BY created_at,delivery_id LIMIT 1", [now]);
      if (!row) return null;
      return { deliveryId: value(row, "delivery_id"), clientId: value(row, "client_id"), verificationId: value(row, "verification_id"), eventVersion: number(row, "event_version"), payload: JSON.parse(value(row, "payload_json")) as Record<string, unknown>, attempt: number(row, "attempt"), nextAttemptAt: value(row, "next_attempt_at") } satisfies KaiPublicWebhookDelivery;
    },

    async completeWebhook(deliveryId, now) {
      await db.batch([{ sql: "UPDATE kai_public_api_webhook_outbox SET status='DELIVERED',delivered_at=?,last_error_code=NULL WHERE delivery_id=? AND status='PENDING'", values: [now, deliveryId] }]);
    },

    async failWebhook(deliveryId, errorCode, nextAttemptAt, terminal) {
      const sanitized = /^[A-Z][A-Z0-9_]{1,79}$/u.test(errorCode) ? errorCode : "WEBHOOK_DELIVERY_FAILED";
      await db.batch([{ sql: "UPDATE kai_public_api_webhook_outbox SET status=?,attempt=attempt+1,next_attempt_at=?,last_error_code=? WHERE delivery_id=? AND status='PENDING'", values: [terminal ? "DEAD" : "PENDING", nextAttemptAt, sanitized, deliveryId] }]);
    },
  };
}
