import type { AccountSessionContext } from "./account-auth.ts";
import { resolveAccountSession } from "./account-auth.ts";
import { alipayReadiness } from "./alipay-live.ts";
import { getAdminOperationsStore, type MemberPersonalCounts } from "./admin-store.ts";
import { isHostingV2Enabled } from "./hosting-v2-feature.ts";
import { getHostingV2Store } from "./hosting-v2-store.ts";

export type MemberHostingCounts = Readonly<{
  orders: number;
  pendingAcceptance: number;
}>;

export type MemberPersonalSummaryCounts = MemberPersonalCounts & Readonly<{
  gpuContracts: number;
  gpuPendingAcceptance: number;
}>;

export type MemberPersonalSummary =
  | Readonly<{ authenticated: false }>
  | Readonly<{
    authenticated: true;
    profile: Readonly<{
      displayName: string;
      maskedEmail: string | null;
      organizationName: string;
      subjectStatus: "PENDING" | "ACTIVE" | "SUSPENDED";
    }>;
    counts: MemberPersonalSummaryCounts;
    payment: Readonly<{ ready: true } | { ready: false; reason: string }>;
  }>;

type PersonalSummaryDependencies = Readonly<{
  resolveSession?: (request: Request) => Promise<AccountSessionContext | null>;
  readCounts?: (organizationId: string, asOf: string) => Promise<MemberPersonalCounts>;
  readHostingCounts?: (organizationId: string, asOf: string) => Promise<MemberHostingCounts>;
  paymentReady?: () => boolean;
  now?: () => Date;
}>;

const EMPTY_HOSTING_COUNTS: MemberHostingCounts = Object.freeze({ orders: 0, pendingAcceptance: 0 });

async function readCurrentOrganizationHostingCounts(organizationId: string, asOf: string): Promise<MemberHostingCounts> {
  if (!isHostingV2Enabled()) return EMPTY_HOSTING_COUNTS;
  const dashboard = await (await getHostingV2Store()).dashboard(organizationId, asOf);
  const buyerContracts = dashboard.contracts.filter((contract) => contract.buyerOrganizationId === organizationId);
  return {
    orders: buyerContracts.length,
    pendingAcceptance: buyerContracts.filter((contract) => contract.status === "AWAITING_ACCEPTANCE").length,
  };
}

export function maskMemberEmail(email: string | null) {
  if (!email) return null;
  const separator = email.lastIndexOf("@");
  if (separator < 1 || separator === email.length - 1) return null;
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  return `${local.slice(0, Math.min(3, local.length))}***@${domain}`;
}

export async function memberPersonalSummary(
  request: Request,
  dependencies: PersonalSummaryDependencies = {},
): Promise<MemberPersonalSummary> {
  const session = await (dependencies.resolveSession ?? resolveAccountSession)(request);
  if (!session) return { authenticated: false };

  const now = (dependencies.now ?? (() => new Date()))().toISOString();
  if (session.membership.status !== "ACTIVE") {
    return {
      authenticated: true,
      profile: {
        displayName: session.account.displayName,
        maskedEmail: maskMemberEmail(session.account.primaryEmail),
        organizationName: session.activeOrganization.name,
        subjectStatus: session.membership.status,
      },
      counts: {
        purchaseRequests: 0,
        orders: 0,
        pendingPayment: 0,
        pendingAcceptance: 0,
        gpuContracts: 0,
        gpuPendingAcceptance: 0,
      },
      payment: { ready: false, reason: "当前交易主体尚未启用" },
    };
  }
  const readCounts = dependencies.readCounts ?? (async (organizationId: string, asOf: string) => (
    await getAdminOperationsStore()
  ).getMemberPersonalCounts(organizationId, asOf));
  const readHostingCounts = dependencies.readHostingCounts ?? readCurrentOrganizationHostingCounts;
  const [legacyCounts, hostingCounts] = await Promise.all([
    readCounts(session.activeOrganization.id, now),
    readHostingCounts(session.activeOrganization.id, now),
  ]);
  const counts: MemberPersonalSummaryCounts = {
    ...legacyCounts,
    orders: legacyCounts.orders + hostingCounts.orders,
    pendingAcceptance: legacyCounts.pendingAcceptance + hostingCounts.pendingAcceptance,
    gpuContracts: hostingCounts.orders,
    gpuPendingAcceptance: hostingCounts.pendingAcceptance,
  };
  const paymentReady = (dependencies.paymentReady ?? (() => alipayReadiness().canCreatePayment))();

  return {
    authenticated: true,
    profile: {
      displayName: session.account.displayName,
      maskedEmail: maskMemberEmail(session.account.primaryEmail),
      organizationName: session.activeOrganization.name,
      subjectStatus: session.membership.status,
    },
    counts,
    payment: paymentReady
      ? { ready: true }
      : { ready: false, reason: "\u652f\u4ed8\u670d\u52a1\u6682\u672a\u5f00\u901a" },
  };
}
