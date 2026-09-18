import { adminQuery, adminRead, adminWrite } from "../_shared";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { AccountAuthError } from "@/lib/server/account-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = adminQuery(request);
  const status = typeof query.status === "string" ? query.status : undefined;
  return adminRead(request, ["PAYMENT_READ"], async () => {
    const allowed = ["PENDING", "APPROVED", "PROCESSING", "MANUAL_REQUIRED", "SUCCEEDED", "FAILED", "REJECTED"] as const;
    if (status && !allowed.includes(status as typeof allowed[number])) throw new AccountAuthError("CARD_HOUR_TOPUP_REFUND_INVALID", 400, "退款状态筛选无效。 ");
    return { records: await (await getCardHourStore()).listTopupRefunds(status as typeof allowed[number] | undefined) };
  });
}

export async function POST(request: Request) {
  return adminWrite(request, ["REFUND_REQUEST"], async (_adminStore, actor, input) => {
    if (typeof input.orderId !== "string" || typeof input.reason !== "string") throw new AccountAuthError("CARD_HOUR_TOPUP_REFUND_INVALID", 400, "退款申请参数无效。 ");
    return (await getCardHourStore()).requestTopupRefund({
      orderId: input.orderId,
      requestedBy: actor.principalId,
      reason: input.reason,
      payloadHash: actor.payloadHash,
      now: new Date().toISOString(),
    });
  });
}
