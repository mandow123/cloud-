import { adminWrite } from "../../../_shared";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { decideAndExecuteTopupRefund } from "@/lib/server/card-hour-topup-refund-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return adminWrite(request, ["REFUND_APPROVE"], async (_adminStore, actor, input) => decideAndExecuteTopupRefund(
    await getCardHourStore(), id, actor.principalId, input,
  ));
}
