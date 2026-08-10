import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { supplyWorkspaceRole } from "@/lib/server/supply-api";
import { getSupplyStore } from "@/lib/server/supply-store";
import { authorizeMarketplaceRequest } from "@/lib/server/marketplace-auth";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { sshProvisionerReadiness } from "@/lib/server/ssh-provisioner";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const context = beginApiRequest(request); let actor: MarketplaceActor | undefined;
  try {
    supplyWorkspaceRole(request, ["supplier"]); const authorization = await authorizeMarketplaceRequest(request); actor = authorization.actor;
    const store = await getSupplyStore(); const poolSummaries = await store.listPools(actor.id);
    const memberGroups = await Promise.all(poolSummaries.map(async ({ pool, policy }) => {
      const [items, windows] = await Promise.all([store.listMembers(actor!.id, pool.id), store.listAvailability(actor!.id, pool.id)]);
      return { poolId: pool.id, specDigest: pool.specDigest, assetKind: pool.assetKind, publicationMode: policy.publicationMode, items, windows };
    }));
    const [listings, orders, offers] = await Promise.all([store.listPromotions(actor.id), store.listTrialOrders(actor.id, "supplier"), store.listOffers(actor.id)]);
    const members = memberGroups.flatMap((group) => group.items);
    const readiness = {
      poolCount: poolSummaries.length,
      memberCount: members.length,
      verifiedMemberCount: members.filter((item) => item.status === "VERIFIED" && item.verifiedUntil && item.verifiedUntil > new Date().toISOString()).length,
      availableWindowCount: memberGroups.flatMap((group) => group.windows).filter((item) => item.status === "AVAILABLE").length,
      activeListingCount: listings.filter((item) => item.status === "ACTIVE").length,
      pendingOrderCount: orders.filter((item) => !["COMPLETED", "CANCELLED", "REFUNDED"].includes(item.status)).length,
      submittedOfferCount: offers.filter((item) => item.status === "SUBMITTED").length,
    };
    const ssh = sshProvisionerReadiness();
    const paymentReadiness = {
      provider: "KAI_CARD_HOUR",
      environment: "LIVE",
      ready: true,
      blockers: [],
    };
    return jsonResponse({
      pools: poolSummaries,
      members,
      groups: memberGroups,
      listings,
      publicationPlans: listings,
      orders,
      offers,
      readiness: { ...readiness, sshProvisionerReady: ssh.configured, sshBlockers: ssh.missing },
      paymentReadiness,
      updatedAt: new Date().toISOString(),
    }, 200, actor.responseHeaders, context);
  } catch (error) { return apiErrorResponse(error, actor?.responseHeaders, context); }
}
