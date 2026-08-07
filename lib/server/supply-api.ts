import { ExchangeDomainError } from "./exchange-errors.ts";
import type { AdminPermission } from "../admin-auth-types.ts";
import { requireAdminPermission } from "./admin-auth.ts";

export type SupplyWorkspaceRole = "buyer" | "supplier" | "ops";

export function supplyWorkspaceRole(request: Request, allowed: readonly SupplyWorkspaceRole[]) {
  const role = request.headers.get("x-kai-workspace-role") as SupplyWorkspaceRole | null;
  if (!role || !allowed.includes(role)) {
    throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, `该操作仅允许 ${allowed.join("/")} 工作台执行。`);
  }
  if (role === "ops") {
    throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "运营权限必须通过服务端管理员会话校验。" );
  }
  return role;
}

/** KAI-owned presets are internal operational writes, never supplier self-service. */
export async function requireKaiSelfPresetOperator(request: Request) {
  return requireAdminPermission(request, ["KAI_SELF_INVENTORY_WRITE"]);
}

export function requireSupplyAdmin(request: Request, permissions: readonly AdminPermission[]) {
  return requireAdminPermission(request, permissions);
}

export async function authorizeSupplyWorkspaceRole(
  request: Request,
  allowed: readonly SupplyWorkspaceRole[],
  opsPermissions: readonly AdminPermission[],
) {
  const requested = request.headers.get("x-kai-workspace-role") as SupplyWorkspaceRole | null;
  if (requested === "ops") {
    if (!allowed.includes("ops")) {
      throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "该操作不允许运营工作台执行。" );
    }
    await requireAdminPermission(request, opsPermissions);
    return "ops" as const;
  }
  return supplyWorkspaceRole(request, allowed.filter((role) => role !== "ops"));
}
