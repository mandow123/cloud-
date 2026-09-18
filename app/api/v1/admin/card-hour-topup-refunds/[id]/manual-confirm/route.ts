import { adminWrite } from "../../../_shared";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { AccountAuthError } from "@/lib/server/account-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return adminWrite(request, ["REFUND_APPROVE"], async (_adminStore, actor, input) => {
    if (typeof input.providerTransactionId !== "string" || typeof input.evidenceDigest !== "string") {
      throw new AccountAuthError("CARD_HOUR_TOPUP_REFUND_MANUAL_INVALID", 400, "人工退款证据无效。 ");
    }
    const record = await (await getCardHourStore()).confirmManualTopupRefund({
      refundId: id,
      approvedBy: actor.principalId,
      providerTransactionId: input.providerTransactionId,
      evidenceDigest: input.evidenceDigest,
      now: new Date().toISOString(),
    });
    return { record, replayed: false };
  });
}
