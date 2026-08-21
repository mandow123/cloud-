import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { adminRead } from "../../_shared.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ demandId: string }> }) {
  const { demandId } = await context.params;
  return adminRead(request, ["FULFILLMENT_READ"], async (store) => {
    const record = await store.getManualDeliveryIntake(demandId);
    if (!record) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "Manual delivery intake not found.");
    return { record };
  });
}
