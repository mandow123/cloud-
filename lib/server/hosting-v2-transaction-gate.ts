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

export type HostingV2TransactionAvailability = Readonly<{
  ready: boolean;
  mode: "TRANSACT" | "BROWSE_ONLY";
  failClosed: true;
  reason: null | "HOSTING_FINANCIAL_RAIL_CLOSED" | "HOSTING_V2_NOT_READY";
  message: string;
}>;

const transactionOpen = (): HostingV2TransactionAvailability => ({
  ready: true,
  mode: "TRANSACT",
  failClosed: true,
  reason: null,
  message: "算力交易能力已就绪。",
});

const transactionClosed = (
  reason: "HOSTING_FINANCIAL_RAIL_CLOSED" | "HOSTING_V2_NOT_READY",
  message: string,
): HostingV2TransactionAvailability => ({ ready: false, mode: "BROWSE_ONLY", failClosed: true, reason, message });

export async function readHostingV2TransactionAvailability(): Promise<HostingV2TransactionAvailability> {
  if (isLocalHostingAcceptance()) return transactionOpen();
  if (!isHostingFinancialRailReady()) {
    return transactionClosed(
      "HOSTING_FINANCIAL_RAIL_CLOSED",
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
    const readiness = evaluateHostingV2Capability({
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
    });
    requireHostingV2TransactionReady(readiness);
    return transactionOpen();
  } catch (error) {
    if (error instanceof AccountAuthError) return transactionClosed("HOSTING_V2_NOT_READY", "算力交易关键能力尚未全部就绪，当前仅开放市场浏览。 ");
    return transactionClosed("HOSTING_V2_NOT_READY", "算力交易关键能力尚未全部就绪。 ");
  }
}

export async function requireHostingV2TransactionCapability() {
  const availability = await readHostingV2TransactionAvailability();
  if (!availability.ready) throw new AccountAuthError(availability.reason ?? "HOSTING_V2_NOT_READY", 503, availability.message);
}
