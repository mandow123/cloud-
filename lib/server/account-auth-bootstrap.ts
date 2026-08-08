import { AccountAuthError, createAccountSession, requireAccountSession, type IssuedAccountSession } from "./account-auth.ts";
import { getAccountAuthStore, type AccountAuthStore, type ResolvedIdentity } from "./account-auth-store.ts";

export type AdminBootstrapEnv = Readonly<{ KAI_ADMIN_BOOTSTRAP_CODE?: string }>;

const PLACEHOLDER_PREFIX = /^(?:change[-_ ]?me|example|insert|placeholder|replace|set[-_ ]?me|todo|your[-_ ])/iu;

export function validatedAdminBootstrapCode(value: string | undefined) {
  const code = value?.trim() ?? "";
  const byteLength = new TextEncoder().encode(code).byteLength;
  const normalized = code.toLowerCase();
  if (byteLength < 32 || PLACEHOLDER_PREFIX.test(normalized) || new Set([...code]).size < 12) {
    throw new AccountAuthError("ADMIN_BOOTSTRAP_NOT_CONFIGURED", 503, "管理员引导暂不可用。");
  }
  return code;
}

async function bootstrapEnvironment(override?: AdminBootstrapEnv): Promise<AdminBootstrapEnv> {
  if (override) return override;
  try {
    const cloudflare = await import("cloudflare:workers");
    const value = cloudflare.env.KAI_ADMIN_BOOTSTRAP_CODE;
    return { KAI_ADMIN_BOOTSTRAP_CODE: typeof value === "string" ? value : undefined };
  } catch {
    return { KAI_ADMIN_BOOTSTRAP_CODE: typeof process === "undefined" ? undefined : process.env.KAI_ADMIN_BOOTSTRAP_CODE };
  }
}

export async function constantTimeBootstrapCodeMatch(expected: string, supplied: string) {
  const encoder = new TextEncoder();
  const [expectedDigest, suppliedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
  ]);
  const left = new Uint8Array(expectedDigest);
  const right = new Uint8Array(suppliedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function denied(
  store: AccountAuthStore,
  context: Awaited<ReturnType<typeof requireAccountSession>>,
  reasonCode: string,
  error: AccountAuthError,
  occurredAt: string,
): Promise<never> {
  await store.recordAudit({
    accountId: context.account.id,
    organizationId: context.activeOrganization.id,
    sessionId: context.sessionId,
    eventType: "ADMIN_BOOTSTRAP_DENIED",
    outcome: "DENIED",
    target: "/api/auth/bootstrap-admin",
    metadata: { reasonCode },
    occurredAt,
  });
  throw error;
}

export async function bootstrapFirstAdministrator(
  request: Request,
  suppliedCode: unknown,
  options: { store?: AccountAuthStore; env?: AdminBootstrapEnv; now?: Date } = {},
): Promise<IssuedAccountSession> {
  const store = options.store ?? await getAccountAuthStore();
  const now = options.now ?? new Date();
  const occurredAt = now.toISOString();
  const context = await requireAccountSession(request, { store, now });

  if (context.authMethod !== "LARK_OAUTH" && context.authMethod !== "EMAIL_OTP") {
    return denied(store, context, "FORMAL_LOGIN_REQUIRED", new AccountAuthError("ADMIN_BOOTSTRAP_FORMAL_LOGIN_REQUIRED", 403, "请先使用飞书或邮箱完成正式登录。"), occurredAt);
  }

  if (await store.isAdminBootstrapClosed()) {
    return denied(store, context, "BOOTSTRAP_CLOSED", new AccountAuthError("ADMIN_BOOTSTRAP_CLOSED", 409, "首位管理员已经建立，管理员引导已永久关闭。"), occurredAt);
  }

  let expectedCode: string;
  try {
    expectedCode = validatedAdminBootstrapCode((await bootstrapEnvironment(options.env)).KAI_ADMIN_BOOTSTRAP_CODE);
  } catch (error) {
    await store.recordAudit({
      accountId: context.account.id,
      organizationId: context.activeOrganization.id,
      sessionId: context.sessionId,
      eventType: "ADMIN_BOOTSTRAP_UNAVAILABLE",
      outcome: "ERROR",
      target: "/api/auth/bootstrap-admin",
      metadata: { reasonCode: "SERVER_CONFIGURATION_INVALID" },
      occurredAt,
    });
    throw error;
  }

  if (typeof suppliedCode !== "string" || !(await constantTimeBootstrapCodeMatch(expectedCode, suppliedCode))) {
    return denied(store, context, "CODE_REJECTED", new AccountAuthError("ADMIN_BOOTSTRAP_CODE_REJECTED", 403, "管理员引导码无效。"), occurredAt);
  }

  const claimed = await store.bootstrapAdminMembership({
    membershipId: context.membership.id,
    accountId: context.account.id,
    organizationId: context.activeOrganization.id,
    sessionId: context.sessionId,
    claimedAt: occurredAt,
  });
  if (!claimed) {
    return denied(store, context, "BOOTSTRAP_CLOSED", new AccountAuthError("ADMIN_BOOTSTRAP_CLOSED", 409, "首位管理员已经建立，管理员引导已永久关闭。"), occurredAt);
  }

  const membership = await store.getMembership(context.account.id, context.activeOrganization.id);
  if (!membership || membership.status !== "ACTIVE" || !membership.roles.includes("ROOT")) {
    await store.recordAudit({ accountId: context.account.id, organizationId: context.activeOrganization.id, sessionId: context.sessionId, eventType: "ADMIN_BOOTSTRAP_SESSION_REFRESH_FAILED", outcome: "ERROR", target: "/api/auth/bootstrap-admin", metadata: {}, occurredAt });
    throw new AccountAuthError("ADMIN_BOOTSTRAP_SESSION_REFRESH_FAILED", 503, "管理员已经建立，请重新登录以刷新权限。");
  }
  const identity: ResolvedIdentity = { account: context.account, organization: membership.organization, membership };
  const issued = await createAccountSession(request, identity, context.authMethod, { store, now });
  await store.revokeSession(context.sessionId, occurredAt);
  return issued;
}
