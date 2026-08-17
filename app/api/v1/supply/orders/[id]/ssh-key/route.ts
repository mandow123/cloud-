import {
  apiErrorResponse,
  beginApiRequest,
  jsonResponse,
  mutationHash,
  prepareWrite,
  readJsonBody,
  requireIdempotencyKey,
} from "@/lib/server/api-guard";
import { requireExchangeRole } from "@/lib/server/exchange-auth";
import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import { registerSshPublicKey, SshProvisionerError } from "@/lib/server/ssh-provisioner";
import { getSupplyStore } from "@/lib/server/supply-store";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { requireLegacyGpuMutationSimulation } from "@/lib/server/legacy-gpu-mutation-gate";

export const dynamic = "force-dynamic";

function publicKeyInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as Record<string, unknown>).publicKey !== "string") {
    throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 400, "请提交 OpenSSH 公钥。");
  }
  return (value as { publicKey: string }).publicKey;
}

export async function POST(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    requireLegacyGpuMutationSimulation();
    await requireExchangeRole(request, "buyer");
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    prepareWrite(request, actor);
    await persistMarketplaceSession(authorization);
    const { id } = await contextValue.params;
    const publicKey = publicKeyInput(await readJsonBody(request));
    const store = await getSupplyStore();
    const detail = await store.getTrialOrder(actor.id, id, "buyer");
    if (detail.order.status !== "PAID" || detail.delivery?.status !== "AWAITING_KEY") {
      throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单尚未完成真实支付，或 SSH 公钥已经提交。");
    }
    const provisioned = await registerSshPublicKey({ orderId: id, publicKey, serviceEndAt: detail.order.endAt });
    const requestKey = requireIdempotencyKey(request);
    const payloadHash = await mutationHash({ orderId: id, fingerprint: provisioned.publicKeyFingerprint });
    await store.transitionTrialOrder(id, {
      actorId: actor.id,
      idempotencyKey: `ssh-order-start:${payloadHash.slice(0, 40)}`,
      payloadHash,
    }, { expectedVersion: detail.order.version, toStatus: "PROVISIONING", reason: "买家公钥已由交付代理接收" });
    const provisioning = await store.updateTrialDelivery(id, {
      actorId: actor.id,
      idempotencyKey: `ssh-delivery-start:${payloadHash.slice(0, 40)}`,
      payloadHash,
    }, {
      expectedVersion: detail.delivery.version,
      toStatus: "PROVISIONING",
      buyerPublicKeyFingerprint: provisioned.publicKeyFingerprint,
    });
    const delivery = await store.updateTrialDelivery(id, {
      actorId: actor.id,
      idempotencyKey: `ssh-delivery-ready:${payloadHash.slice(0, 40)}`,
      payloadHash,
    }, {
      expectedVersion: provisioning.record.version,
      toStatus: "READY",
      secureEndpointRef: provisioned.secureEndpointRef,
      hostKeyFingerprint: provisioned.hostKeyFingerprint,
      credentialExpiresAt: provisioned.credentialExpiresAt,
    });
    const refreshed = await store.getTrialOrder(actor.id, id, "buyer");
    await store.transitionTrialOrder(id, {
      actorId: actor.id,
      idempotencyKey: `ssh-order-delivered:${payloadHash.slice(0, 40)}`,
      payloadHash,
    }, { expectedVersion: refreshed.order.version, toStatus: "DELIVERED", reason: "短期 SSH 交付已准备" });
    return jsonResponse({
      orderId: id,
      status: delivery.record.status,
      publicKeyFingerprint: provisioned.publicKeyFingerprint,
      hostKeyFingerprint: provisioned.hostKeyFingerprint,
      credentialExpiresAt: provisioned.credentialExpiresAt,
      commandId: requestKey,
    }, 200, actor.responseHeaders, context);
  } catch (error) {
    if (error instanceof SshProvisionerError) {
      return jsonResponse({ error: { code: error.code, message: error.message, requestId: context.requestId } }, error.code === "SSH_PROVISIONER_NOT_CONFIGURED" ? 503 : 502, actor?.responseHeaders, context);
    }
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
