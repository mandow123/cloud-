import type { AccountSessionContext } from "./account-auth.ts";
import { AccountAuthError } from "./account-auth.ts";
import { getHostingV2Store } from "./hosting-v2-store.ts";

export const HOSTING_SERVICE_SCOPES = ["REGISTER", "PUBLISH", "FULFILL", "BUY", "FINANCE_READ"] as const;
export type HostingServiceScope = (typeof HOSTING_SERVICE_SCOPES)[number];

export function hostingServiceScopeForRequest(request: Request): HostingServiceScope | null {
  const path = new URL(request.url).pathname;
  if (/^\/api\/v2\/contracts(?:\/|$)/u.test(path)) return "BUY";
  if (!path.startsWith("/api/v2/supply/")) return null;
  if (path === "/api/v2/supply/earnings") return "FINANCE_READ";
  if (/^\/api\/v2\/supply\/contracts(?:\/|$)/u.test(path)) return "FULFILL";
  if (/^\/api\/v2\/supply\/(?:agent-challenges|devices)(?:\/|$)/u.test(path)) return request.method === "GET" ? "REGISTER" : "PUBLISH";
  if (/^\/api\/v2\/supply\/offers(?:\/|$)/u.test(path)) return request.method === "GET" ? "REGISTER" : "PUBLISH";
  if (/^\/api\/v2\/supply\/(?:profile|policy|dashboard)(?:\/|$)/u.test(path)) return "REGISTER";
  return null;
}

export function hostingServiceScopesForFacts(input: { supplierApproved: boolean }) {
  const scopes: HostingServiceScope[] = ["REGISTER", "BUY"];
  if (input.supplierApproved) scopes.push("PUBLISH", "FULFILL", "FINANCE_READ");
  return Object.freeze(scopes);
}

export async function requireHostingServiceScope(account: AccountSessionContext, required: HostingServiceScope) {
  if (required === "REGISTER" || required === "BUY") return;
  const dashboard = await (await getHostingV2Store()).dashboard(account.activeOrganization.id, new Date().toISOString());
  const scopes = hostingServiceScopesForFacts({ supplierApproved: dashboard.readiness.supplierApproved });
  if (!scopes.includes(required)) {
    throw new AccountAuthError(
      "HOSTING_SERVICE_SCOPE_REQUIRED",
      403,
      `当前组织缺少 ${required} 权限；供应协议、身份与权属审核通过后才能安装 Agent、发布、履约或查看供应收益。 `,
    );
  }
}
