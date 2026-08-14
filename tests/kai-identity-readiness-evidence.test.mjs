import assert from "node:assert/strict";
import test from "node:test";

import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";

const now = "2026-08-14T09:00:00.000Z";
const idleExpiresAt = "2026-08-14T09:30:00.000Z";
const absoluteExpiresAt = "2026-08-14T17:00:00.000Z";

test("only an allowed KAI Identity login audit backed by its OIDC session satisfies readiness", async () => {
  const store = await createSqliteAccountAuthStore(":memory:");
  try {
    assert.equal(await store.hasSuccessfulKaiIdentityLoginAudit(), false);

    const administrator = await store.resolveOrCreatePasswordAdministrator({
      username: "kai-root",
      displayName: "KAI Cloud Root",
      createdAt: now,
    });
    const passwordSession = await store.createSession({
      tokenHash: "password-session-token-hash",
      accountId: administrator.account.id,
      organizationId: administrator.organization.id,
      authMethod: "ADMIN_PASSWORD",
      now,
      idleExpiresAt,
      absoluteExpiresAt,
    });
    await store.recordAudit({
      accountId: administrator.account.id,
      organizationId: administrator.organization.id,
      sessionId: passwordSession.id,
      eventType: "LOGIN_SUCCEEDED",
      outcome: "ALLOWED",
      metadata: { authMethod: "ADMIN_PASSWORD" },
      occurredAt: now,
    });
    assert.equal(await store.hasSuccessfulKaiIdentityLoginAudit(), false, "administrator password login is not Identity evidence");

    const identity = await store.resolveOrCreateKaiIdentity({
      issuer: "https://auth.kai.com/api/auth",
      subject: "cloud-supplier-user",
      displayName: "Cloud Supplier",
      verifiedEmail: "supplier@example.com",
      verifiedAt: now,
    });
    const identitySession = await store.createSession({
      tokenHash: "identity-session-token-hash",
      accountId: identity.account.id,
      organizationId: identity.organization.id,
      authMethod: "KAI_IDENTITY_OIDC",
      now,
      idleExpiresAt,
      absoluteExpiresAt,
    });
    assert.equal(await store.hasSuccessfulKaiIdentityLoginAudit(), false, "an OIDC session alone is not an audited successful login");

    await store.recordAudit({
      accountId: identity.account.id,
      organizationId: identity.organization.id,
      sessionId: identitySession.id,
      eventType: "LOGIN_SUCCEEDED",
      outcome: "ALLOWED",
      metadata: { authMethod: "KAI_IDENTITY_OIDC" },
      occurredAt: now,
    });
    assert.equal(await store.hasSuccessfulKaiIdentityLoginAudit(), true);
  } finally {
    store.close();
  }
});
