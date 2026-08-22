import { redactAdminManualAppealMutation, rejectAppealEvidence, requireManualAppealsEnabled } from "@/lib/server/manual-appeals";
import { adminWrite } from "../../../_shared.ts";
export const dynamic="force-dynamic";
export async function POST(request:Request,ctx:{params:Promise<{caseId:string}>}){const{caseId}=await ctx.params;return adminWrite(request,["APPEAL_HANDLE"],async(store,actor,input)=>{requireManualAppealsEnabled();rejectAppealEvidence(input.evidenceIds);return redactAdminManualAppealMutation(await store.addAdminManualAppealMessage(actor,caseId,input));});}
