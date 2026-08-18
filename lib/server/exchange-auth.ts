import type { ExchangeWorkspaceRole } from "../exchange.ts";
import { ExchangeDomainError } from "./exchange-errors.ts";
import type { AdminPermission } from "../admin-auth-types.ts";
import { requireAdminPermission } from "./admin-auth.ts";
import { requireTradingAccountSession } from "./entity-ownership.ts";

/**
 * Buyer/supplier is a workspace view, not an authorization credential. The
 * browser may still send x-kai-workspace-role to select UI behavior, but every
 * exchange operation is authorized by the signed account session and the
 * store's organization ownership checks.
 */
export async function requireExchangeRole(request: Request, expected: ExchangeWorkspaceRole) {
  if (expected === "ops") {
    throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "运营权限必须通过服务端管理员会话校验。" );
  }
  await requireTradingAccountSession(request);
  return expected;
}

export function requireExchangeAdmin(request: Request, permissions: readonly AdminPermission[]) {
  return requireAdminPermission(request, permissions);
}
