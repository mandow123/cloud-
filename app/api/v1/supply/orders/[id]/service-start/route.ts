import {
  apiErrorResponse,
  assertSecureWrite,
  beginApiRequest,
  jsonResponse,
  mutationHash,
  requireIdempotencyKey,
} from "@/lib/server/api-guard";
import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { startSshService, SshProvisionerError } from "@/lib/server/ssh-provisioner";
import { requireSupplyAdmin } from "@/lib/server/supply-api";
import { getSupplyStore } from "@/lib/server/supply-store";
import { requireLegacyGpuMutationSimulation } from "@/lib/server/legacy-gpu-mutation-gate";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireLegacyGpuMutationSimulation();
    await requireSupplyAdmin(request, ["FULFILLMENT_OPERATE"]);
    assertSecureWrite(request);
    const { id } = await contextValue.params;
    const store = await getSupplyStore();
    const detail = await store.getTrialOrder("supply-ops", id, "ops");
    const latestCheck = detail.connectionChecks.at(-1);
    const now = Date.now();
    if (detail.order.status !== "DELIVERED" || detail.delivery?.status !== "READY"
      || latestCheck?.status !== "PASSED"
      || now < Date.parse(detail.order.startAt) || now > Date.parse(detail.order.endAt)
      || !detail.delivery.credentialExpiresAt || now > Date.parse(detail.delivery.credentialExpiresAt)) {
      throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单窗口、短期凭据或最新连接检查未满足开机条件。");
    }
    const providerReceipt = await startSshService(id);
    const key = requireIdempotencyKey(request);
    const payloadHash = await mutationHash({ orderId: id, providerReceipt });
    const delivery = await store.updateTrialDelivery(id, {
      actorId: "supply-ops", idempotencyKey: `${key}:delivery`, payloadHash,
    }, { expectedVersion: detail.delivery.version, toStatus: "IN_SERVICE" });
    const order = await store.transitionTrialOrder(id, {
      actorId: "supply-ops", idempotencyKey: `${key}:order`, payloadHash,
    }, { expectedVersion: detail.order.version, toStatus: "IN_SERVICE", reason: "服务窗口内连接检查通过并开始计量" });
    return jsonResponse({ order: order.record, delivery: delivery.record, evidenceDigest: providerReceipt.evidenceDigest }, 200, undefined, context);
  } catch (error) {
    if (error instanceof SshProvisionerError) {
      return jsonResponse({ error: { code: error.code, message: error.message, requestId: context.requestId } }, error.code === "SSH_PROVISIONER_NOT_CONFIGURED" ? 503 : 502, undefined, context);
    }
    return apiErrorResponse(error, undefined, context);
  }
}
