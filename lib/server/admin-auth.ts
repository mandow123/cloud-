import { ADMIN_PERMISSIONS, ADMIN_ROLES, type AdminAuthContext, type AdminPermission, type AdminRole } from "../admin-auth-types.ts";
import { AccountAuthError, requireAccountSession } from "./account-auth.ts";
import { getAccountAuthStore } from "./account-auth-store.ts";

const allPermissions = [...ADMIN_PERMISSIONS] as readonly AdminPermission[];
const delegatedAdminPermissions = ADMIN_PERMISSIONS.filter((permission) =>
  permission !== "ROOT_CONTROL" && permission !== "IDENTITY_MANAGE" && permission !== "MEMBERSHIP_MANAGE"
);
const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  ROOT: allPermissions,
  ROLE_ADMIN: delegatedAdminPermissions,
  INTAKE_OPERATOR: ["ADMIN_PANEL_READ", "SUPPLY_INTAKE_READ", "SUPPLY_INTAKE_REVIEW"],
  INVENTORY_OPERATOR: ["ADMIN_PANEL_READ", "KAI_SELF_INVENTORY_READ", "KAI_SELF_INVENTORY_WRITE"],
  VERIFICATION_REVIEWER: ["ADMIN_PANEL_READ", "VERIFICATION_QUEUE_READ", "VERIFICATION_REVIEW"],
  MARKET_OPERATOR: ["ADMIN_PANEL_READ", "MARKET_READ", "MARKET_PUBLISH"],
  FULFILLMENT_OPERATOR: ["ADMIN_PANEL_READ", "FULFILLMENT_READ", "FULFILLMENT_OPERATE"],
  FINANCE_OPERATOR: ["ADMIN_PANEL_READ", "PAYMENT_READ", "PAYMENT_OPERATE", "SETTLEMENT_OPERATE", "REFUND_REQUEST"],
  FINANCE_APPROVER: ["ADMIN_PANEL_READ", "PAYMENT_READ", "REFUND_APPROVE"],
  SUPPORT_READONLY: ["ADMIN_PANEL_READ", "SUPPORT_READ"],
  AUDITOR: ["ADMIN_PANEL_READ", "IDENTITY_READ", "SUPPLY_INTAKE_READ", "KAI_SELF_INVENTORY_READ", "VERIFICATION_QUEUE_READ", "MARKET_READ", "FULFILLMENT_READ", "PAYMENT_READ", "AUDIT_READ"],
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
  if (accountContext.membership.status !== "ACTIVE") {
    throw new AccountAuthError("ADMIN_ACCESS_FORBIDDEN", 403, "组织成员关系尚未获批。 ");
  }
  const roles = accountContext.membership.roles;
  const permissions = adminPermissionsForRoles(roles);
  if (roles.length === 0) throw new AccountAuthError("ADMIN_ACCESS_FORBIDDEN", 403, "账户没有管理员角色。 ");
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
