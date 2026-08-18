import { adminQuery, adminRead, adminWrite } from "../_shared";
import { requireLegacyGpuMutationSimulation } from "@/lib/server/legacy-gpu-mutation-gate";
export const dynamic="force-dynamic";
export async function GET(request:Request){return adminRead(request,["PAYMENT_READ"],store=>store.listRefundCases(adminQuery(request)));}
export async function POST(request:Request){return adminWrite(request,["REFUND_REQUEST"],(store,actor,input)=>{requireLegacyGpuMutationSimulation();return store.requestRefund(actor,input);});}
