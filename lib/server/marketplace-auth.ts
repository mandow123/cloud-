import { resolveMarketplaceActor, type MarketplaceActor } from "@/lib/server/marketplace-actor";
import { getMarketplaceStore, type MarketplaceStore } from "@/lib/server/marketplace-store";

export type MarketplaceAuthorization = {
  actor: MarketplaceActor;
  store: MarketplaceStore;
};

/** Establishes or validates a server-side demo session and transparently
 * rotates expired/unknown cookies. */
export async function authorizeMarketplaceRequest(request: Request): Promise<MarketplaceAuthorization> {
  const store = await getMarketplaceStore();
  const actor = await resolveMarketplaceActor(request);
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
