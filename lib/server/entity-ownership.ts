import type { AccountSessionContext } from "@/lib/server/account-auth";
import { accountAuthDigest, requireAccountSession } from "@/lib/server/account-auth";
import { getAdminOperationsStore, type AdminSourceSystem } from "@/lib/server/admin-store";

export async function bindNewEntityToOrganization(input: {
  account: AccountSessionContext;
  sourceSystem: Exclude<AdminSourceSystem, "ADMIN">;
  entityType: string;
  entityId: string;
  businessIdempotencyKey: string;
  legacyActorId?: string | null;
}) {
  const payload = {
    sourceSystem: input.sourceSystem,
    entityType: input.entityType,
    entityId: input.entityId,
    organizationId: input.account.activeOrganization.id,
    accountId: input.account.account.id,
    legacyActorId: input.legacyActorId ?? null,
    expectedVersion: 0,
    reason: "新建业务记录必须绑定当前已认证交易主体",
  } as const;
  return (await getAdminOperationsStore()).bindEntityOrganization({
    principalId: input.account.account.id,
    idempotencyKey: `ownership:${input.businessIdempotencyKey}`,
    payloadHash: await accountAuthDigest(JSON.stringify(payload)),
  }, payload);
}

/** Exact-value escape hatch for pre-account automated regression fixtures.
 * Application and deployment environments never set this value. */
export async function requireTradingAccountSession(request: Request) {
  if (process.env.KAI_ALLOW_LEGACY_ANON_WRITES === "TEST_ONLY_UNSAFE") return null;
  return requireAccountSession(request);
}
