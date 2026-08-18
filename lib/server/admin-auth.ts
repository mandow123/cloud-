import { ADMIN_PERMISSIONS, ADMIN_ROLES, type AdminAuthContext, type AdminPermission, type AdminRole } from "../admin-auth-types.ts";
import { AccountAuthError, requireAccountSession } from "./account-auth.ts";
import { getAccountAuthStore } from "./account-auth-store.ts";

const allPermissions = [...ADMIN_PERMISSIONS] as readonly AdminPermission[];
const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  ROOT: allPermissions,
  ROLE_ADMIN: [],
  INTAKE_OPERATOR: [],
  INVENTORY_OPERATOR: [],
  VERIFICATION_REVIEWER: [],
  MARKET_OPERATOR: [],
  FULFILLMENT_OPERATOR: [],
  FINANCE_OPERATOR: [],
  FINANCE_APPROVER: ["ADMIN_PANEL_READ", "PAYMENT_READ", "SETTLEMENT_OPERATE", "AUDIT_READ"],
  SUPPORT_READONLY: [],
  AUDITOR: [],
};

const validRoles = new Set<string>(ADMIN_ROLES);

export function adminPermissionsForRoles(roles: readonly AdminRole[]): AdminPermission[] {
  const permissions = new Set<AdminPermission>();
  for (const role of roles) {
    if (!validRoles.has(role)) throw new Error("ADMIN_ROLE_INVALID");
    for (const permission of ROLE_PERMISSIONS[role]) permissions.add(permission);
  }
  return ADMIN_PERMISSIONS.filter((permission) => permissions.has(permission));
}

export function hasAdminPermission(context: AdminAuthContext, permission: AdminPermission) {
  return context.principal.permissions.includes(permission);
}

export async function authenticateAdminRequest(request: Request): Promise<AdminAuthContext> {
  const accountContext = await requireAccountSession(request);
  if (accountContext.authMethod !== "ADMIN_PASSWORD") {
    throw new AccountAuthError("ADMIN_ACCESS_FORBIDDEN", 403, "管理员后台只接受独立账号密码登录。 ");
  }
  if (accountContext.membership.status !== "ACTIVE") {
    throw new AccountAuthError("ADMIN_ACCESS_FORBIDDEN", 403, "组织成员关系尚未获批。 ");
  }
  const roles = accountContext.membership.roles;
  const permissions = adminPermissionsForRoles(roles);
  if (!roles.some((role) => role === "ROOT" || role === "FINANCE_APPROVER") || permissions.length === 0) {
    throw new AccountAuthError("ADMIN_ACCESS_FORBIDDEN", 403, "当前账号不是已授权的密码管理员。 ");
  }
  return {
    principal: { id: accountContext.account.id, displayName: accountContext.account.displayName, roles, permissions, status: "ACTIVE" },
    account: accountContext.account, organization: accountContext.activeOrganization, sessionId: accountContext.sessionId,
  };
}

export async function requireAdminPermission(request: Request, permissions: readonly AdminPermission[]) {
  const context = await authenticateAdminRequest(request);
  const missing = permissions.filter((permission) => !hasAdminPermission(context, permission));
  if (missing.length) {
    const store = await getAccountAuthStore();
    await store.recordAudit({ accountId: context.principal.id, organizationId: context.organization.id, sessionId: context.sessionId, eventType: "PERMISSION_DENIED", outcome: "DENIED", target: new URL(request.url).pathname, metadata: { required: permissions, missing }, occurredAt: new Date().toISOString() });
    throw new AccountAuthError("ADMIN_ACCESS_FORBIDDEN", 403, "管理员权限不足。 ");
  }
  return context;
}
