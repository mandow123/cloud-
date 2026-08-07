import { resolveMarketplaceActor, type MarketplaceActor } from "@/lib/server/marketplace-actor";
import { readAccountSessionToken, resolveAccountSession } from "@/lib/server/account-auth";
import { getMarketplaceStore, type MarketplaceStore } from "@/lib/server/marketplace-store";

export type MarketplaceAuthorization = {
  actor: MarketplaceActor;
  store: MarketplaceStore;
};

/** Establishes or validates a server-side anonymous session and transparently
 * rotates expired/unknown cookies. */
export async function authorizeMarketplaceRequest(request: Request): Promise<MarketplaceAuthorization> {
  const store = await getMarketplaceStore();
  const browserActor = await resolveMarketplaceActor(request);
  const account = readAccountSessionToken(request) ? await resolveAccountSession(request) : null;
  const actor: MarketplaceActor = account
    ? { ...browserActor, id: account.activeOrganization.id, source: "account-session" }
    : browserActor;
  return { actor, store };
}

export async function persistMarketplaceSession({ actor, store }: MarketplaceAuthorization) {
  if (actor.isNew) {
    await store.establishSession(actor);
    return;
  }

  if (await store.touchSession(actor)) return;
  // A high-entropy cookie first becomes server-persisted on the first write.
  // Reads and the session bootstrap endpoint never create database rows.
  await store.establishSession(actor);
}
