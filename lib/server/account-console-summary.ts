import type { AccountSessionContext } from "./account-auth.ts";
import { AccountAuthError } from "./account-auth.ts";
import type { MemberAccountConsoleRecords } from "./admin-store.ts";
import { getAdminOperationsStore } from "./admin-store.ts";
import type { CardHourDashboard } from "./card-hour-store.ts";
import { getCardHourStore } from "./card-hour-store.ts";
import { requireTradingAccountSession } from "./entity-ownership.ts";
import { getSupplyStore } from "./supply-store.ts";

export type AccountConsoleSummary = Readonly<{
  account: Readonly<{
    displayName: string;
    organizationName: string;
    subjectStatus: "ACTIVE";
  }>;
  buyer: Readonly<{
    cardHours: Readonly<{
      availableMicros: number;
      heldMicros: number;
    }>;
    purchaseIntents: MemberAccountConsoleRecords["purchaseIntents"];
  }>;
  supplier: Readonly<{
    available: boolean;
    approved: boolean;
    status: AccountConsoleSupplierStatus;
    subjectStatus: "ACTIVE";
    applications: MemberAccountConsoleRecords["supplyApplications"];
  }>;
}>;

export type AccountConsoleSupplierStatus = "NOT_SUBMITTED" | "PENDING_REVIEW" | "NEEDS_ATTENTION" | "VERIFIED_NOT_PUBLISHED" | "PUBLISHED";

export function accountConsoleSupplierStatus(applications: MemberAccountConsoleRecords["supplyApplications"]): AccountConsoleSupplierStatus {
  if (applications.needsAttention > 0) return "NEEDS_ATTENTION";
  if (applications.published > 0) return "PUBLISHED";
  if (applications.verified > 0) return "VERIFIED_NOT_PUBLISHED";
  if (applications.pendingReview > 0) return "PENDING_REVIEW";
  return "NOT_SUBMITTED";
}

type AccountConsoleSummaryDependencies = Readonly<{
  requireSession?: (request: Request) => Promise<AccountSessionContext | null>;
  readCardHours?: (organizationId: string, now: string) => Promise<CardHourDashboard>;
  readRecords?: (organizationId: string) => Promise<MemberAccountConsoleRecords>;
  now?: () => Date;
}>;

async function readCurrentOrganizationRecords(organizationId: string) {
  // The ownership-aware query joins supply records, so initialize that existing
  // schema first on a brand-new installation. This does not create application data.
  await getSupplyStore();
  return (await getAdminOperationsStore()).getMemberAccountConsoleRecords(organizationId, 5);
}

export async function getAccountConsoleSummary(
  request: Request,
  dependencies: AccountConsoleSummaryDependencies = {},
): Promise<AccountConsoleSummary> {
  const account = await (dependencies.requireSession ?? requireTradingAccountSession)(request);
  if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
  const organizationId = account.activeOrganization.id;
  const now = (dependencies.now ?? (() => new Date()))().toISOString();
  const [cardHourDashboard, records] = await Promise.all([
    (dependencies.readCardHours ?? (async (id, at) => (await getCardHourStore()).dashboard(id, at)))(organizationId, now),
    (dependencies.readRecords ?? readCurrentOrganizationRecords)(organizationId),
  ]);

  return {
    account: {
      displayName: account.account.displayName,
      organizationName: account.activeOrganization.name,
      subjectStatus: "ACTIVE",
    },
    buyer: {
      cardHours: {
        availableMicros: cardHourDashboard.balance.availableMicros,
        heldMicros: cardHourDashboard.balance.heldMicros,
      },
      purchaseIntents: records.purchaseIntents,
    },
    supplier: {
      available: records.supplyApplications.total > 0,
      approved: records.supplyApplications.approved > 0,
      status: accountConsoleSupplierStatus(records.supplyApplications),
      subjectStatus: "ACTIVE",
      applications: records.supplyApplications,
    },
  };
}
