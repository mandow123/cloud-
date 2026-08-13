import { AccountAuthError } from "./account-auth.ts";
import { alipayReadiness } from "./alipay-live.ts";
import { getCardHourStore } from "./card-hour-store.ts";
import { getHostingV2Store } from "./hosting-v2-store.ts";
import { requireHostingV2TransactionReady } from "./hosting-v2-readiness.ts";
import { evaluateHostingV2Capability } from "./hosting-v2-readiness.ts";
import { probeKaiIdentityDiscovery } from "./kai-identity-oidc.ts";

type Environment = Record<string, string | undefined>;

export function isLocalHostingAcceptance(environment: Environment = typeof process === "undefined" ? {} : process.env) {
  return environment.KAI_ENVIRONMENT === "LOCAL"
    && environment.KAI_HOSTING_LOCAL_ACCEPTANCE === "1";
}

export async function requireHostingV2TransactionCapability() {
  if (isLocalHostingAcceptance()) return;
  try {
    const environment: Environment = typeof process === "undefined" ? {} : process.env;
    const now = new Date().toISOString();
    const [operations, cardHourHealth, identity] = await Promise.all([
      (await getHostingV2Store()).readiness(now),
      (await getCardHourStore()).health(),
      environment.KAI_ACCOUNT_OIDC_CLIENT_ID?.trim() && environment.KAI_ACCOUNT_OIDC_TRANSACTION_SECRET?.trim()
        ? probeKaiIdentityDiscovery()
        : Promise.resolve({ available: false as const, probe: "read-only" as const }),
    ]);
    requireHostingV2TransactionReady(evaluateHostingV2Capability({
      environment,
      hostingStorage: { ready: operations.integrity === "ok" },
      cardHourStorage: { ready: cardHourHealth.integrity === "ok" },
      operations,
      kaiIdentityAvailable: identity.available,
      adminPasswordAvailable: Boolean(environment.KAI_ADMIN_USERNAME?.trim() && environment.KAI_ADMIN_PASSWORD_HASH?.startsWith("pbkdf2-sha256:")),
      financeApprovalAvailable: Boolean(environment.KAI_ADMIN_APPROVER_USERNAME?.trim() && environment.KAI_ADMIN_APPROVER_PASSWORD_HASH?.startsWith("pbkdf2-sha256:")),
      alipay: alipayReadiness(environment),
    }));
  } catch (error) {
    if (error instanceof AccountAuthError) throw error;
    throw new AccountAuthError("HOSTING_V2_NOT_READY", 503, "算力交易关键能力尚未全部就绪。 ");
  }
}
