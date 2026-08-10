import { AccountAuthError, type AccountSessionContext } from "./account-auth.ts";
import { adminPermissionsForRoles } from "./admin-auth.ts";
import { getAccountAuthStore, type AccountAuthStore } from "./account-auth-store.ts";

export async function accountSessionEnvelope(context: AccountSessionContext, store?: AccountAuthStore) {
  const finalStore = store ?? await getAccountAuthStore();
  const memberships = await finalStore.listMemberships(context.account.id);
  const roles = context.membership.status === "ACTIVE" ? context.membership.roles : [];
  const rootRoles = roles.includes("ROOT") ? (["ROOT"] as const) : [];
  const permissions = adminPermissionsForRoles(rootRoles);
  return {
    authenticated: true as const,
    account: context.account,
    organization: context.activeOrganization,
    memberships,
    ...(rootRoles.length ? { admin: { principal: { id: context.account.id, displayName: context.account.displayName, roles: rootRoles, permissions, status: "ACTIVE" as const }, sessionId: context.sessionId } } : {}),
  };
}

export async function readAuthJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new AccountAuthError("AUTH_JSON_REQUIRED", 400, "请求正文必须使用 JSON 格式。");
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > 16 * 1024) {
    throw new AccountAuthError("AUTH_PAYLOAD_TOO_LARGE", 400, "认证请求正文过大。");
  }
  try {
    return await request.json() as unknown;
  } catch {
    throw new AccountAuthError("AUTH_JSON_INVALID", 400, "请求正文不是有效的 JSON。");
  }
}
