import type { AccountSessionContext } from "./account-auth.ts";
import { AccountAuthError, accountAuthDigest, requireAccountSession } from "./account-auth.ts";
import { getAdminOperationsStore, type AdminSourceSystem } from "./admin-store.ts";

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
  const account = await requireAccountSession(request);
  if (account.membership.status !== "ACTIVE") {
    throw new AccountAuthError("TRADING_SUBJECT_INACTIVE", 403, "当前交易主体尚未启用，不能创建购买、供应或订单记录。 ");
  }
  if (account.membership.roles.some((role) => role === "ROOT" || role === "FINANCE_APPROVER")) {
    throw new AccountAuthError(
      "TRADING_ADMIN_ROLE_FORBIDDEN",
      403,
      "后台 Root 与独立财务审批身份不能参与买卖、供应或收款；如需交易，请切换到不含后台权限的独立组织。 ",
    );
  }
  return account;
}
