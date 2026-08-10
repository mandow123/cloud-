import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createSqliteAdminOperationsStore } from "../lib/server/admin-store-sqlite.ts";
import { maskMemberEmail, memberPersonalSummary } from "../lib/server/member-personal-summary.ts";

const AS_OF = new Date("2026-08-09T08:00:00.000Z");

const session = {
  account: {
    id: "acct_private",
    displayName: "KAI Buyer",
    primaryEmail: "buyer.person@example.com",
    status: "ACTIVE",
  },
  activeOrganization: {
    id: "org_current",
    name: "Current Buyer Organization",
    externalKey: "PRIVATE:CURRENT",
    status: "ACTIVE",
  },
  membership: {
    id: "mbr_private",
    accountId: "acct_private",
    organizationId: "org_current",
    status: "ACTIVE",
    roles: ["ROOT"],
  },
  sessionId: "session_private",
  authMethod: "ADMIN_PASSWORD",
};

function databaseFixture() {
  const directory = mkdtempSync(join(tmpdir(), "kai-personal-summary-"));
  const path = join(directory, "summary.sqlite");
  return { path, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("personal summary returns only the unauthenticated envelope without reading private stores", async () => {
  let countReads = 0;
  const summary = await memberPersonalSummary(new Request("http://localhost/api/v1/member/personal-summary"), {
    resolveSession: async () => null,
    readCounts: async () => {
      countReads += 1;
      throw new Error("must not read counts");
    },
    paymentReady: () => { throw new Error("must not inspect payment readiness"); },
  });
  assert.deepEqual(summary, { authenticated: false });
  assert.equal(countReads, 0);
});

test("authenticated personal summary uses the current organization and exposes only masked profile facts", async () => {
  const reads = [];
  const summary = await memberPersonalSummary(new Request("http://localhost/api/v1/member/personal-summary"), {
    resolveSession: async () => session,
    readCounts: async (organizationId, asOf) => {
      reads.push({ organizationId, asOf });
      return { purchaseRequests: 3, orders: 4, pendingPayment: 1, pendingAcceptance: 2 };
    },
    paymentReady: () => false,
    now: () => AS_OF,
  });

  assert.deepEqual(reads, [{ organizationId: "org_current", asOf: AS_OF.toISOString() }]);
  assert.deepEqual(summary, {
    authenticated: true,
    profile: {
      displayName: "KAI Buyer",
      maskedEmail: "buy***@example.com",
      organizationName: "Current Buyer Organization",
      subjectStatus: "ACTIVE",
    },
    counts: { purchaseRequests: 3, orders: 4, pendingPayment: 1, pendingAcceptance: 2 },
    payment: { ready: false, reason: "\u652f\u4ed8\u670d\u52a1\u6682\u672a\u5f00\u901a" },
  });
  const encoded = JSON.stringify(summary);
  for (const secret of ["acct_private", "org_current", "PRIVATE:CURRENT", "buyer.person@example.com", "ROOT", "session_private"]) {
    assert.equal(encoded.includes(secret), false, `summary must not expose ${secret}`);
  }

  const ready = await memberPersonalSummary(new Request("http://localhost/api/v1/member/personal-summary"), {
    resolveSession: async () => session,
    readCounts: async () => ({ purchaseRequests: 0, orders: 0, pendingPayment: 0, pendingAcceptance: 0 }),
    paymentReady: () => true,
    now: () => AS_OF,
  });
  assert.deepEqual(ready.payment, { ready: true });
});

test("inactive memberships do not read organization transaction counts", async () => {
  let countReads = 0;
  const summary = await memberPersonalSummary(new Request("http://localhost/api/v1/member/personal-summary"), {
    resolveSession: async () => ({
      ...session,
      membership: { ...session.membership, status: "SUSPENDED" },
    }),
    readCounts: async () => {
      countReads += 1;
      throw new Error("must not read organization counts");
    },
    paymentReady: () => { throw new Error("must not inspect payment readiness"); },
    now: () => AS_OF,
  });
  assert.equal(countReads, 0);
  assert.deepEqual(summary.counts, { purchaseRequests: 0, orders: 0, pendingPayment: 0, pendingAcceptance: 0 });
  assert.deepEqual(summary.payment, { ready: false, reason: "当前交易主体尚未启用" });
  assert.equal(summary.profile.subjectStatus, "SUSPENDED");
});

test("email masking never returns a complete address", () => {
  assert.equal(maskMemberEmail("kai@example.com"), "kai***@example.com");
  assert.equal(maskMemberEmail("a@example.com"), "a***@example.com");
  assert.equal(maskMemberEmail(null), null);
  assert.equal(maskMemberEmail("not-an-email"), null);
});

test("member counts are organization-bound and keep purchase requests separate from formal orders", async () => {
  const fixture = databaseFixture();
  let store;
  try {
    store = await createSqliteAdminOperationsStore(fixture.path);
    const database = new DatabaseSync(fixture.path);
    database.exec(`
      CREATE TABLE marketplace_requests_v2 (
        id TEXT PRIMARY KEY,
        request_type TEXT NOT NULL
      );
      CREATE TABLE exchange_orders (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        hold_expires_at TEXT NOT NULL
      );
      CREATE TABLE exchange_order_lifecycle (
        order_id TEXT PRIMARY KEY,
        phase TEXT NOT NULL
      );
      CREATE TABLE exchange_payment_intents (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
    const insertRequest = database.prepare("INSERT INTO marketplace_requests_v2(id,request_type) VALUES(?,?)");
    insertRequest.run("request-current", "procurement");
    insertRequest.run("swap-current", "swap");
    insertRequest.run("request-other", "procurement");

    const insertOrder = database.prepare("INSERT INTO exchange_orders(id,status,hold_expires_at) VALUES(?,?,?)");
    insertOrder.run("order-payable", "AWAITING_PAYMENT", "2026-08-09T09:00:00.000Z");
    insertOrder.run("order-payment-expired", "AWAITING_PAYMENT", "2026-08-09T07:59:59.000Z");
    insertOrder.run("order-acceptance", "AWAITING_PAYMENT", "2026-08-09T09:00:00.000Z");
    insertOrder.run("order-other-org", "AWAITING_PAYMENT", "2026-08-09T09:00:00.000Z");
    const insertLifecycle = database.prepare("INSERT INTO exchange_order_lifecycle(order_id,phase) VALUES(?,?)");
    insertLifecycle.run("order-payable", "AWAITING_PAYMENT");
    insertLifecycle.run("order-payment-expired", "AWAITING_PAYMENT");
    insertLifecycle.run("order-acceptance", "AWAITING_ACCEPTANCE");
    insertLifecycle.run("order-other-org", "AWAITING_PAYMENT");
    const insertPayment = database.prepare("INSERT INTO exchange_payment_intents(id,order_id,status,expires_at) VALUES(?,?,?,?)");
    insertPayment.run("payment-payable", "order-payable", "PENDING", "2026-08-09T09:00:00.000Z");
    insertPayment.run("payment-expired", "order-payment-expired", "PENDING", "2026-08-09T07:59:59.000Z");
    insertPayment.run("payment-accepted", "order-acceptance", "CAPTURED", "2026-08-09T09:00:00.000Z");
    insertPayment.run("payment-other", "order-other-org", "PENDING", "2026-08-09T09:00:00.000Z");

    const insertOwnership = database.prepare(`INSERT INTO admin_entity_ownership(
      source_system,entity_type,entity_id,organization_id,account_id,legacy_actor_id,
      bound_by_principal_id,created_at,updated_at,version
    ) VALUES(?,?,?,?,?,NULL,?,?,?,1)`);
    const at = AS_OF.toISOString();
    for (const [sourceSystem, entityType, entityId, organizationId] of [
      ["MARKETPLACE", "DEMAND", "request-current", "org_current"],
      ["MARKETPLACE", "DEMAND", "swap-current", "org_current"],
      ["MARKETPLACE", "DEMAND", "request-other", "org_other"],
      ["EXCHANGE", "ORDER", "order-payable", "org_current"],
      ["EXCHANGE", "ORDER", "order-payment-expired", "org_current"],
      ["EXCHANGE", "ORDER", "order-acceptance", "org_current"],
      ["EXCHANGE", "ORDER", "order-other-org", "org_other"],
    ]) {
      insertOwnership.run(sourceSystem, entityType, entityId, organizationId, "acct", "principal", at, at);
    }
    database.close();

    assert.deepEqual(await store.getMemberPersonalCounts("org_current", AS_OF.toISOString()), {
      purchaseRequests: 1,
      orders: 3,
      pendingPayment: 1,
      pendingAcceptance: 1,
    });
    assert.deepEqual(await store.getMemberPersonalCounts("org_other", AS_OF.toISOString()), {
      purchaseRequests: 1,
      orders: 1,
      pendingPayment: 1,
      pendingAcceptance: 0,
    });
    await assert.rejects(() => store.getMemberPersonalCounts("org_current", "not-a-date"), /valid timestamp/u);
  } finally {
    await store?.close?.();
    fixture.cleanup();
  }
});
