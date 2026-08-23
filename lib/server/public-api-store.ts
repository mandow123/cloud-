import type { KaiPublicVerification, KaiPublicWebhookDelivery } from "../kai-public-api.ts";

export type KaiPublicApiSql = Readonly<{ sql: string; values?: readonly unknown[] }>;
export interface KaiPublicApiDatabaseAdapter {
  first<T>(sql: string, values?: readonly unknown[]): Promise<T | null>;
  all<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  batch(items: readonly KaiPublicApiSql[]): Promise<Array<{ changes: number }>>;
  ensureSchema(statements: readonly string[], version: number): Promise<void>;
}

export type KaiPublicMutationContext = Readonly<{
  clientId: string;
  organizationId: string;
  organizationReference: string;
  actorId: string;
  idempotencyKey: string;
  payloadHash: string;
  now: string;
}>;

export interface KaiPublicApiStore {
  createVerification(context: KaiPublicMutationContext, input: {
    resourceReference: string;
    productCode: string;
    region: string;
    specifications: Readonly<Record<string, unknown>>;
  }): Promise<{ record: KaiPublicVerification; replayed: boolean }>;
  getVerification(clientId: string, verificationId: string): Promise<KaiPublicVerification | null>;
  getCurrentVerification(clientId: string, resourceReference: string): Promise<KaiPublicVerification | null>;
  revokeVerification(context: KaiPublicMutationContext, verificationId: string): Promise<{ record: KaiPublicVerification; replayed: boolean }>;
  bindChallenge(context: KaiPublicMutationContext, resourceReference: string, challengeId: string): Promise<KaiPublicVerification>;
  getChallengeBinding(clientId: string, challengeId: string): Promise<{ verificationId: string; resourceReference: string; deviceId: string | null } | null>;
  bindDevice(clientId: string, challengeId: string, deviceId: string, now: string): Promise<KaiPublicVerification>;
  setVerificationCommand(clientId: string, verificationId: string, commandId: string, now: string): Promise<KaiPublicVerification>;
  syncVerification(clientId: string, deviceId: string, status: KaiPublicVerification["status"], failure: KaiPublicVerification["failure"], now: string): Promise<KaiPublicVerification | null>;
  nextWebhook(now: string): Promise<KaiPublicWebhookDelivery | null>;
  completeWebhook(deliveryId: string, now: string): Promise<void>;
  failWebhook(deliveryId: string, errorCode: string, nextAttemptAt: string, terminal: boolean): Promise<void>;
}

let singleton: Promise<KaiPublicApiStore> | null = null;
export async function getKaiPublicApiStore(): Promise<KaiPublicApiStore> {
  if (singleton) return singleton;
  singleton = (async () => {
    try {
      const cloudflare = await import("cloudflare:workers");
      if (cloudflare.env.DB) return (await import("./public-api-store-d1.ts")).createD1KaiPublicApiStore(cloudflare.env.DB);
    } catch { /* Node deployments do not expose Cloudflare bindings. */ }
    return (await import("./public-api-store-sqlite.ts")).createSqliteKaiPublicApiStore();
  })();
  return singleton;
}
