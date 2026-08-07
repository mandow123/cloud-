import type { ExchangeWorkspaceRole } from "../exchange.ts";
import { ExchangeDomainError } from "./exchange-errors.ts";
import type { AdminPermission } from "../admin-auth-types.ts";
import { requireAdminPermission } from "./admin-auth.ts";

/**
 * Temporary workspace boundary until the organization identity provider is
 * connected. It keeps role behavior explicit without pretending to be the
 * final authentication system.
 */
export function requireExchangeRole(request: Request, expected: ExchangeWorkspaceRole) {
  if (expected === "ops") {
    throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "运营权限必须通过服务端管理员会话校验。" );
  }
  const supplied = request.headers.get("x-kai-workspace-role");
  if (supplied !== expected) {
    throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, `该操作仅允许 ${expected} 工作台执行。`);
  }
  return expected;
}

export function requireExchangeAdmin(request: Request, permissions: readonly AdminPermission[]) {
  return requireAdminPermission(request, permissions);
}
