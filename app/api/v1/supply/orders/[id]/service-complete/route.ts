import {
  apiErrorResponse,
  assertSecureWrite,
  beginApiRequest,
  jsonResponse,
  mutationHash,
  requireIdempotencyKey,
} from "@/lib/server/api-guard";
import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { stopSshService, SshProvisionerError } from "@/lib/server/ssh-provisioner";
import { requireSupplyAdmin } from "@/lib/server/supply-api";
import { getSupplyStore } from "@/lib/server/supply-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const context = beginApiRequest(request);
  try {
    await requireSupplyAdmin(request, ["FULFILLMENT_OPERATE"]);
    assertSecureWrite(request);
    const { id } = await contextValue.params;
    const store = await getSupplyStore();
    const detail = await store.getTrialOrder("supply-ops", id, "ops");
    if (detail.order.status !== "IN_SERVICE" || detail.delivery?.status !== "IN_SERVICE") {
      throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单不在服务中。");
    }
    const providerReceipt = await stopSshService(id);
    const key = requireIdempotencyKey(request);
    const payloadHash = await mutationHash({ orderId: id, providerReceipt });
    const delivery = await store.updateTrialDelivery(id, {
      actorId: "supply-ops", idempotencyKey: `${key}:delivery`, payloadHash,
    }, { expectedVersion: detail.delivery.version, toStatus: "CLEANING" });
    const order = await store.transitionTrialOrder(id, {
      actorId: "supply-ops", idempotencyKey: `${key}:order`, payloadHash,
    }, { expectedVersion: detail.order.version, toStatus: "COMPLETED", reason: "预约服务结束，等待撤权和数据清理" });
    return jsonResponse({ order: order.record, delivery: delivery.record, evidenceDigest: providerReceipt.evidenceDigest }, 200, undefined, context);
  } catch (error) {
    if (error instanceof SshProvisionerError) {
      return jsonResponse({ error: { code: error.code, message: error.message, requestId: context.requestId } }, error.code === "SSH_PROVISIONER_NOT_CONFIGURED" ? 503 : 502, undefined, context);
    }
    return apiErrorResponse(error, undefined, context);
  }
}
