import { DatabaseSync } from "node:sqlite";
import { createSupplyStore } from "../../lib/server/supply-store-core.ts";
import { createCardHourStore } from "../../lib/server/card-hour-store-core.ts";
import { adminIdentitySchemaStatements } from "../../db/admin-identity-schema.ts";
import { adminOperationsSchemaStatements } from "../../db/admin-operations-schema.ts";
import { accountAuthDigest } from "../../lib/server/account-auth.ts";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
let command = 0;

function context(actorId, prefix = "supply") {
  command += 1;
  return {
    actorId,
    idempotencyKey: `${prefix}:${String(command).padStart(12, "0")}`,
    payloadHash: command % 2 ? DIGEST_A : DIGEST_B,
  };
}

function addHours(value, hours) {
  return new Date(Date.parse(value) + hours * 3_600_000).toISOString();
}

function addDays(value, days) {
  return new Date(Date.parse(value) + days * 86_400_000).toISOString();
}

function nextWholeHour() {
  const value = new Date(Date.now() + 3 * 3_600_000);
  value.setUTCMinutes(0, 0, 0);
  return value.toISOString();
}

async function buildVerifiedH100(store) {
  const supplier = "supplier-kai-owned";
  const specDigest = `sha256:${"1".repeat(64)}`;
  const poolResult = await store.createPool(context(supplier, "pool"), {
    externalRef: "kai-h100-node-001",
    assetKind: "H100_8X_NODE",
    name: "KAI 自有 8×H100 SXM5 80GB",
    region: "中国香港",
    deliveryForm: "DEDICATED_SSH",
    specDigest,
  });
  const pool = poolResult.record.pool;
  const memberResult = await store.batchMembers(pool.id, context(supplier, "members"), [{
    externalRef: "h100-physical-node-001",
    serialDigest: `sha256:${"2".repeat(64)}`,
    hardwareUuidDigest: `sha256:${"3".repeat(64)}`,
    specDigest,
  }]);
  const member = memberResult.record.items[0];
  await store.batchComponents(member.id, context(supplier, "components"), Array.from({ length: 8 }, (_, index) => ({
    componentType: "GPU",
    identityDigest: `sha256:${index.toString(16).padStart(64, "0")}`,
    model: "NVIDIA H100 SXM5",
    memoryGiB: 80,
    topologyGroup: "NVSWITCH-NODE-001",
    specs: { migMode: "DISABLED", gpuIndex: index },
  })));
  const job = (await store.createVerificationJob(context(supplier, "verify-job"), member.id)).record;
  for (const evidenceType of ["GPU_INVENTORY", "GPU_TOPOLOGY", "GPU_BURN_IN", "SSH_CONNECTIVITY"]) {
    await store.addVerificationEvidence(job.id, context("ops-kai", "evidence"), {
      evidenceType,
      payloadDigest: DIGEST_A,
      summary: `${evidenceType} passed on the KAI-owned node`,
      observedAt: new Date().toISOString(),
    });
  }
  const mainStart = nextWholeHour();
  const mainEnd = addHours(mainStart, 12);
  const distantStart = addDays(mainStart, 31);
  const distantEnd = addHours(distantStart, 40);
  await store.completeVerification(job.id, context("ops-kai", "verify-complete"), {
    decision: "PASS",
    validUntil: addDays(distantEnd, 2),
  });
  const windows = (await store.batchAvailability(pool.id, context(supplier, "windows"), [
    { memberId: member.id, startAt: mainStart, endAt: mainEnd },
    { memberId: member.id, startAt: distantStart, endAt: distantEnd },
  ])).record.items;
  return { supplier, pool, member, mainStart, mainEnd, windows };
}

export const fixtureAccount = { account: { id: "acct-buyer", status: "ACTIVE" }, activeOrganization: { id: "org-buyer", status: "ACTIVE" }, membership: { status: "ACTIVE", roles: [] }, sessionId: "fixture", authMethod: "EMAIL_OTP" };
export function databaseAdapter(db) {
  return {
    first: async (sql, values = []) => db.prepare(sql).get(...values) ?? null,
    all: async (sql, values = []) => db.prepare(sql).all(...values),
    batch: async (items) => {
      db.exec("BEGIN IMMEDIATE");
      try { const result = items.map(({ sql, values = [] }) => ({ changes: Number(db.prepare(sql).run(...values).changes) })); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    ensureSchema: async (statements) => { for (const sql of statements) db.exec(sql); },
  };
}
export async function paymentFixture(account = fixtureAccount) {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  const adapter = databaseAdapter(db);
  for (const sql of [...adminIdentitySchemaStatements, ...adminOperationsSchemaStatements]) db.exec(sql);
  const at = new Date().toISOString();
  db.prepare("INSERT INTO admin_user_accounts(id,display_name,status,created_at,updated_at) VALUES(?,'Fixture','ACTIVE',?,?)").run(account.account.id,at,at);
  db.prepare("INSERT INTO admin_organizations(id,name,external_key,status,created_at,updated_at) VALUES(?,'Fixture',?,'ACTIVE',?,?)").run(account.activeOrganization.id,account.activeOrganization.id,at,at);
  db.prepare("INSERT INTO admin_memberships(id,account_id,organization_id,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)").run(`membership-${account.account.id}`,account.account.id,account.activeOrganization.id,at,at);
  const supply = await createSupplyStore(adapter);
  const card = await createCardHourStore(adapter);
  const fixture = await buildVerifiedH100(supply);
  const promotion = (await supply.commitPromotion(fixture.pool.id, context(fixture.supplier,"promotion"), [fixture.windows[0].id])).record.promotions[0];
  async function createOrder(offset = 0) {
    const order = (await supply.createTrialOrder(context(account.activeOrganization.id,"order"), { promotionId: promotion.id, startAt: addHours(fixture.mainStart,offset), endAt: addHours(fixture.mainStart,offset+1) })).record;
    db.prepare("INSERT INTO admin_entity_ownership(source_system,entity_type,entity_id,organization_id,account_id,bound_by_principal_id,created_at,updated_at) VALUES('SUPPLY_PILOT','ORDER',?,?,?,?,?,?)").run(order.id, account.activeOrganization.id, account.account.id, account.account.id, order.createdAt, order.createdAt);
    return order;
  }
  const order = await createOrder();
  await card.dashboard(account.activeOrganization.id, order.createdAt);
  db.prepare("UPDATE card_hour_wallets SET available_micros=100000000 WHERE organization_id=?").run(account.activeOrganization.id);
  const input = { account, actorId: account.activeOrganization.id, orderId: order.id, idempotencyKey: "payment-fixture-000001", now: order.createdAt };
  async function legacyDebit() {
    const amountMicros = Math.ceil(order.amountCents * 500 * 10000 / 501);
    const payloadHash = await accountAuthDigest(JSON.stringify({ orderId: order.id, assetCode: "KAI_CREDIT_HOUR", amountMicros }));
    return card.captureOrder({ ...input, sourceSystem: "SUPPLY_PILOT", amountMicros, cnyReferenceCents: order.amountCents, payloadHash });
  }
  return { db, adapter, supply, card, order, createOrder, account, input, legacyDebit };
}
