import {
  apiErrorResponse,
  assertSecureWrite,
  beginApiRequest,
  jsonResponse,
  mutationHash,
  requireIdempotencyKey,
} from "@/lib/server/api-guard";
import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { runSshConnectionCheck, SshProvisionerError } from "@/lib/server/ssh-provisioner";
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
    if (detail.order.status !== "DELIVERED" || detail.delivery?.status !== "READY") {
      throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "SSH 交付尚未准备完成。");
    }
    const check = await runSshConnectionCheck(id);
    const key = requireIdempotencyKey(request);
    const result = await store.recordTrialConnectionCheck(id, {
      actorId: "supply-ops",
      idempotencyKey: key,
      payloadHash: await mutationHash({ orderId: id, ...check }),
    }, check);
    return jsonResponse({ record: result.record, replayed: result.replayed }, result.replayed ? 200 : 201, undefined, context);
  } catch (error) {
    if (error instanceof SshProvisionerError) {
      return jsonResponse({ error: { code: error.code, message: error.message, requestId: context.requestId } }, error.code === "SSH_PROVISIONER_NOT_CONFIGURED" ? 503 : 502, undefined, context);
    }
    return apiErrorResponse(error, undefined, context);
  }
}
