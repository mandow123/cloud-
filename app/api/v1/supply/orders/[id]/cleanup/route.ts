import {
  apiErrorResponse,
  assertSecureWrite,
  beginApiRequest,
  jsonResponse,
  mutationHash,
  requireIdempotencyKey,
} from "@/lib/server/api-guard";
import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { cleanSshService, SshProvisionerError } from "@/lib/server/ssh-provisioner";
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
    if (detail.order.status !== "COMPLETED" || detail.delivery?.status !== "CLEANING") {
      throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单尚未进入清理阶段。");
    }
    const providerReceipt = await cleanSshService(id);
    const key = requireIdempotencyKey(request);
    const payloadHash = await mutationHash({ orderId: id, providerReceipt });
    const delivery = await store.updateTrialDelivery(id, {
      actorId: "supply-ops", idempotencyKey: key, payloadHash,
    }, {
      expectedVersion: detail.delivery.version,
      toStatus: "COMPLETED",
      cleanupEvidenceDigest: providerReceipt.evidenceDigest,
    });
    return jsonResponse({ orderId: id, delivery: delivery.record, relistAllowed: true }, 200, undefined, context);
  } catch (error) {
    if (error instanceof SshProvisionerError) {
      return jsonResponse({ error: { code: error.code, message: error.message, requestId: context.requestId } }, error.code === "SSH_PROVISIONER_NOT_CONFIGURED" ? 503 : 502, undefined, context);
    }
    return apiErrorResponse(error, undefined, context);
  }
}
