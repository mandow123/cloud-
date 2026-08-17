import { adminWrite } from "../../../_shared";
import { retryApprovedRefund } from "@/lib/server/admin-refund-executor";
import { requireLegacyGpuMutationSimulation } from "@/lib/server/legacy-gpu-mutation-gate";

export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;
  return adminWrite(request,["REFUND_APPROVE"],(store,actor,input)=>{requireLegacyGpuMutationSimulation();return retryApprovedRefund(store,id,actor,input);});
}
