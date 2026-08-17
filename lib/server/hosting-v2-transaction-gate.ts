import { AccountAuthError } from "./account-auth.ts";
import { alipayReadiness } from "./alipay-live.ts";
import { getCardHourStore } from "./card-hour-store.ts";
import { getAccountAuthStore } from "./account-auth-store.ts";
import { getHostingV2Store } from "./hosting-v2-store.ts";
import { requireHostingV2TransactionReady } from "./hosting-v2-readiness.ts";
import { evaluateHostingV2Capability } from "./hosting-v2-readiness.ts";
import { probeKaiIdentityDiscovery } from "./kai-identity-oidc.ts";

type Environment = Record<string, string | undefined>;

export function isLocalHostingAcceptance(environment: Environment = typeof process === "undefined" ? {} : process.env) {
  return environment.KAI_ENVIRONMENT === "LOCAL"
    && environment.KAI_HOSTING_LOCAL_ACCEPTANCE === "1";
}

// Product audit 2026-08-17: production trading stays closed until the V2
// double-entry hold/release/refund rail, reconciliation health checks and
// pending-income reversal workflow are implemented and separately approved.
export const HOSTING_FINANCIAL_RAIL_STATUS = "CLOSED_PENDING_LEDGER_V2" as const;

export function isHostingFinancialRailReady() {
  return false;
}

export async function requireHostingV2TransactionCapability() {
  if (isLocalHostingAcceptance()) return;
  if (!isHostingFinancialRailReady()) {
    throw new AccountAuthError(
      "HOSTING_FINANCIAL_RAIL_CLOSED",
      503,
      "算力交易资金链路正在完成双式账本、退款与收益冲正验收，当前仅开放市场浏览。 ",
    );
  }
  try {
    const environment: Environment = typeof process === "undefined" ? {} : process.env;
    const now = new Date().toISOString();
    const [operations, cardHourHealth, identity, kaiIdentityLoginAudited] = await Promise.all([
      (await getHostingV2Store()).readiness(now),
      (await getCardHourStore()).health(),
      environment.KAI_ACCOUNT_OIDC_CLIENT_ID?.trim() && environment.KAI_ACCOUNT_OIDC_TRANSACTION_SECRET?.trim()
        ? probeKaiIdentityDiscovery({ env: environment })
        : Promise.resolve({ available: false as const, probe: "read-only" as const }),
      getAccountAuthStore().then((store) => store.hasSuccessfulKaiIdentityLoginAudit()),
    ]);
    requireHostingV2TransactionReady(evaluateHostingV2Capability({
      environment,
      hostingStorage: { ready: operations.integrity === "ok" },
      cardHourStorage: { ready: cardHourHealth.integrity === "ok" },
      operations,
      kaiIdentityAvailable: identity.available,
      kaiIdentityLoginAudited,
      adminPasswordAvailable: Boolean(environment.KAI_ADMIN_USERNAME?.trim() && environment.KAI_ADMIN_PASSWORD_HASH?.startsWith("pbkdf2-sha256:")),
      financeApprovalAvailable: Boolean(environment.KAI_ADMIN_APPROVER_USERNAME?.trim() && environment.KAI_ADMIN_APPROVER_PASSWORD_HASH?.startsWith("pbkdf2-sha256:")),
      financialRailReady: isHostingFinancialRailReady(),
      alipay: alipayReadiness(environment),
    }));
  } catch (error) {
    if (error instanceof AccountAuthError) throw error;
    throw new AccountAuthError("HOSTING_V2_NOT_READY", 503, "算力交易关键能力尚未全部就绪。 ");
  }
}
