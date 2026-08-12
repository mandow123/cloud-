import { hashText, resolveMarketplaceActor, type MarketplaceActor } from "@/lib/server/marketplace-actor";
import { readAccountSessionToken, resolveAccountSession } from "@/lib/server/account-auth";
import { getMarketplaceStore, type MarketplaceStore } from "@/lib/server/marketplace-store";

export type MarketplaceAuthorization = {
  actor: MarketplaceActor;
  sessionActor: MarketplaceActor;
  store: MarketplaceStore;
};

/** Establishes or validates a server-side anonymous session and transparently
 * rotates expired/unknown cookies. */
export async function authorizeMarketplaceRequest(request: Request): Promise<MarketplaceAuthorization> {
  const store = await getMarketplaceStore();
  const browserActor = await resolveMarketplaceActor(request);
  const account = readAccountSessionToken(request) ? await resolveAccountSession(request) : null;
  const actor: MarketplaceActor = account
    ? {
        ...browserActor,
        id: account.activeOrganization.id,
        source: "account-session",
      }
    : browserActor;
  const sessionActor = account
    ? {
        ...browserActor,
        id: `acctsess_${(await hashText(`${browserActor.sessionHash}:${account.activeOrganization.id}`)).slice(0, 40)}`,
        source: "account-session" as const,
        sessionHash: await hashText(`${browserActor.sessionHash}:${account.activeOrganization.id}`),
      }
    : browserActor;
  return { actor, sessionActor, store };
}

export async function persistMarketplaceSession({ sessionActor, store }: MarketplaceAuthorization) {
  if (sessionActor.isNew) {
    await store.establishSession(sessionActor);
    return;
  }

  if (await store.touchSession(sessionActor)) return;
  // A high-entropy cookie first becomes server-persisted on the first write.
  // Reads and the session bootstrap endpoint never create database rows.
  await store.establishSession(sessionActor);
}
