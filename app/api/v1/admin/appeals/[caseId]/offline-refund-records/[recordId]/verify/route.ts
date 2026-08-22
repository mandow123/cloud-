import { redactAdminManualAppealMutation, requireManualAppealsEnabled } from "@/lib/server/manual-appeals";
import { adminWrite } from "../../../../../_shared.ts";
export const dynamic="force-dynamic";
export async function POST(request:Request,ctx:{params:Promise<{caseId:string;recordId:string}>}){const{caseId,recordId}=await ctx.params;return adminWrite(request,["OFFLINE_REFUND_VERIFY"],async(store,actor,input)=>{requireManualAppealsEnabled();return redactAdminManualAppealMutation(await store.verifyAdminManualAppealOfflineRefund(actor,caseId,recordId,input));});}
