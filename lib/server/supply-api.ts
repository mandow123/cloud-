import { ExchangeDomainError } from "./exchange-errors.ts";
import type { AdminPermission } from "../admin-auth-types.ts";
import { requireAdminPermission } from "./admin-auth.ts";
import { requireTradingAccountSession } from "./entity-ownership.ts";

export type SupplyWorkspaceRole = "buyer" | "supplier" | "ops";
type TradingWorkspaceRole = Exclude<SupplyWorkspaceRole, "ops">;

export async function supplyWorkspaceRole(request: Request, allowed: readonly SupplyWorkspaceRole[]): Promise<TradingWorkspaceRole> {
  const view = request.headers.get("x-kai-workspace-role") as SupplyWorkspaceRole | null;
  await requireTradingAccountSession(request);
  const availableViews = allowed.filter((role): role is TradingWorkspaceRole => role !== "ops");
  if (availableViews.length === 0) {
    throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "该操作必须通过运营工作台执行。" );
  }
  // A valid value selects the view only. Missing, forged, or stale values do
  // not grant or revoke authority; the endpoint and entity ownership do that.
  return view && view !== "ops" && availableViews.includes(view) ? view : availableViews[0];
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
  return await supplyWorkspaceRole(request, allowed.filter((role) => role !== "ops"));
}
