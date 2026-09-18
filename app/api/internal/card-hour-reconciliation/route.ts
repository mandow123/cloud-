import { isInternalReconciliationRequest } from "@/lib/server/internal-reconciliation-auth";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { getAdminOperationsStore } from "@/lib/server/admin-store";
import { createCardHourReconciliationWorker } from "@/lib/server/card-hour-reconciliation-worker";
import { qixiangPayReconciliationReadiness } from "@/lib/server/qixiang-pay";

export const dynamic = "force-dynamic";
declare global { var __kaiCardHourReconciliationWorker: ReturnType<typeof createCardHourReconciliationWorker> | undefined; }


export async function POST(request: Request) {
  // Socket peer is enforced by loopback binding + public Nginx /api/internal deny.
  // Host headers alone are not a substitute for that mandatory deployment gate.
  if (!isInternalReconciliationRequest(request)) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!qixiangPayReconciliationReadiness().canReconcilePayment) return Response.json({ error: "RECONCILIATION_DISABLED" }, { status: 503 });
  await getAdminOperationsStore();
  globalThis.__kaiCardHourReconciliationWorker ??= createCardHourReconciliationWorker({ store: await getCardHourStore() });
  return Response.json(await globalThis.__kaiCardHourReconciliationWorker.tick(), { headers: { "cache-control": "no-store" } });
}
