import { adminWrite } from "../../_shared.ts";

export function manualDeliveryAction(
  request: Request,
  demandId: string,
  action: "ASSIGN" | "START" | "MARK_DELIVERED" | "CANCEL" | "REVOKE",
) {
  return adminWrite(request, ["FULFILLMENT_OPERATE"], (store, actor, input) =>
    store.transitionManualDelivery(actor, demandId, action, input));
}
