import type { AccountSessionContext } from "./account-auth.ts";
import { isAgentTelemetryV1Enabled } from "./agent-telemetry-feature.ts";
import { getHostingV2Store } from "./hosting-v2-store.ts";

const APPLICATION_ID = /^[A-Za-z0-9-]{8,96}$/u;

export async function isTelemetryApplicationEligibleForAccount(
  account: AccountSessionContext | null,
  applicationId: string | null | undefined,
  now = new Date().toISOString(),
) {
  const normalized = applicationId?.trim() ?? "";
  if (!isAgentTelemetryV1Enabled() || !account || !APPLICATION_ID.test(normalized)) return false;
  if (account.account.status !== "ACTIVE" || account.activeOrganization.status !== "ACTIVE" || account.membership.status !== "ACTIVE") return false;
  if (account.membership.organizationId !== account.activeOrganization.id || account.membership.accountId !== account.account.id) return false;
  if (account.membership.roles.some((role) => role === "ROOT" || role === "FINANCE_APPROVER")) return false;
  try {
    const eligible = await (await getHostingV2Store()).telemetryEligibleApplicationIds(
      account.activeOrganization.id,
      [normalized],
      now,
    );
    return eligible.includes(normalized);
  } catch {
    return false;
  }
}
