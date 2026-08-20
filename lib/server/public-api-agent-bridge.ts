import type { HostingDevice } from "../hosting-v2.ts";
import type { HostingV2Store } from "./hosting-v2-store.ts";
import { hostingAgentDigest } from "./hosting-agent-crypto.ts";
import { kaiPublicApiClients, type KaiPublicApiClient } from "./public-api-auth.ts";
import { isKaiPublicApiEnabled } from "./public-api-feature.ts";
import { getKaiPublicApiStore, type KaiPublicApiStore } from "./public-api-store.ts";
import { kaiPublicVerificationState } from "./public-api-service.ts";
import { deliverOneKaiPublicWebhook } from "./public-api-webhook.ts";

type BridgeDependencies = Readonly<{
  enabled?: boolean;
  clients?: readonly KaiPublicApiClient[];
  publicStore?: KaiPublicApiStore;
  deliverWebhook?: typeof deliverOneKaiPublicWebhook;
}>;

async function dependencies(overrides: BridgeDependencies) {
  const enabled = overrides.enabled ?? isKaiPublicApiEnabled();
  if (!enabled) return null;
  return {
    clients: overrides.clients ?? kaiPublicApiClients(),
    publicStore: overrides.publicStore ?? await getKaiPublicApiStore(),
    deliverWebhook: overrides.deliverWebhook ?? (overrides.publicStore ? null : deliverOneKaiPublicWebhook),
  };
}

export async function bindKaiPublicDevice(
  challengeId: string,
  device: HostingDevice,
  now: string,
  overrides: BridgeDependencies = {},
) {
  const resolved = await dependencies(overrides);
  if (!resolved) return null;
  for (const client of resolved.clients) {
    if (client.organizationId !== device.organizationId) continue;
    const binding = await resolved.publicStore.getChallengeBinding(client.clientId, challengeId);
    if (binding) return resolved.publicStore.bindDevice(client.clientId, challengeId, device.id, now);
  }
  return null;
}

export async function syncKaiPublicHeartbeat(
  hostingStore: HostingV2Store,
  device: HostingDevice,
  now: string,
  overrides: BridgeDependencies = {},
) {
  const resolved = await dependencies(overrides);
  if (!resolved) return [];
  const updates = [];
  const state = kaiPublicVerificationState(device, new Date(now));
  for (const client of resolved.clients) {
    if (client.organizationId !== device.organizationId) continue;
    let verification = await resolved.publicStore.syncVerification(client.clientId, device.id, state.status, state.failure, now);
    if (verification && !verification.commandId && verification.status === "running") {
      try {
        const command = await hostingStore.queueVerification(device.organizationId, device.id, {
          actorId: `oauth:${client.clientId}`,
          idempotencyKey: `public-verify:${verification.id}`,
          payloadHash: await hostingAgentDigest({ verificationId: verification.id, deviceId: device.id }),
          now,
        });
        verification = await resolved.publicStore.setVerificationCommand(client.clientId, verification.id, command.id, now);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EXCHANGE_STATE_CONFLICT")) throw error;
      }
    }
    if (verification) updates.push(verification);
  }
  if (updates.length && resolved.deliverWebhook) await resolved.deliverWebhook({ store: resolved.publicStore });
  return updates;
}
