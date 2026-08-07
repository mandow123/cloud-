import { adminWrite } from "../../../_shared";
import { decideAndExecuteRefund } from "@/lib/server/admin-refund-executor";
export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){const {id}=await context.params;return adminWrite(request,["REFUND_APPROVE"],(store,actor,input)=>decideAndExecuteRefund(store,id,actor,input));}
