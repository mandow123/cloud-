import type {
  AppendStandardizationSnapshot,
  KaiHoursAccountEnvelope,
  KaiStandardQuoteEnvelope,
  StandardizationMutationContext,
} from "../standardization.ts";

export type StandardizationMutationResult<T> = Readonly<{ record: T; replayed: boolean }>;

export interface StandardizationStore {
  appendSnapshot(
    context: StandardizationMutationContext,
    input: AppendStandardizationSnapshot,
  ): Promise<StandardizationMutationResult<KaiStandardQuoteEnvelope>>;
  getQuotes(at?: Date): Promise<KaiStandardQuoteEnvelope>;
  getAccountProjection(organizationId: string, at?: Date): Promise<KaiHoursAccountEnvelope>;
}

declare global {
  var __kaiStandardizationStorePromise: Promise<StandardizationStore> | undefined;
}

async function resolveStandardizationStore(): Promise<StandardizationStore> {
  try {
    const cloudflare = await import("cloudflare:workers");
    if (cloudflare.env.DB) {
      const { createD1StandardizationStore } = await import("./standardization-store-d1.ts");
      return createD1StandardizationStore(cloudflare.env.DB);
    }
  } catch {
    // Node deployments do not expose the Cloudflare environment module.
  }
  const { createSqliteStandardizationStore } = await import("./standardization-store-sqlite.ts");
  return createSqliteStandardizationStore();
}

export function getStandardizationStore() {
  globalThis.__kaiStandardizationStorePromise ??= resolveStandardizationStore().catch((error) => {
    globalThis.__kaiStandardizationStorePromise = undefined;
    throw error;
  });
  return globalThis.__kaiStandardizationStorePromise;
}
