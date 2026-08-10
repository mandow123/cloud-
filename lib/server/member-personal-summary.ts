import type { AccountSessionContext } from "./account-auth.ts";
import { resolveAccountSession } from "./account-auth.ts";
import { alipayReadiness } from "./alipay-live.ts";
import { getAdminOperationsStore, type MemberPersonalCounts } from "./admin-store.ts";

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
    counts: MemberPersonalCounts;
    payment: Readonly<{ ready: true } | { ready: false; reason: string }>;
  }>;

type PersonalSummaryDependencies = Readonly<{
  resolveSession?: (request: Request) => Promise<AccountSessionContext | null>;
  readCounts?: (organizationId: string, asOf: string) => Promise<MemberPersonalCounts>;
  paymentReady?: () => boolean;
  now?: () => Date;
}>;

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
      counts: { purchaseRequests: 0, orders: 0, pendingPayment: 0, pendingAcceptance: 0 },
      payment: { ready: false, reason: "当前交易主体尚未启用" },
    };
  }
  const readCounts = dependencies.readCounts ?? (async (organizationId: string, asOf: string) => (
    await getAdminOperationsStore()
  ).getMemberPersonalCounts(organizationId, asOf));
  const counts = await readCounts(session.activeOrganization.id, now);
  const paymentReady = (dependencies.paymentReady ?? (() => alipayReadiness().configured))();

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
