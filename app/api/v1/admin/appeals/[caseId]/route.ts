import { AccountAuthError } from "@/lib/server/account-auth";
import { redactAdminManualAppealEvidence, requireManualAppealsEnabled } from "@/lib/server/manual-appeals";
import { adminRead } from "../../_shared.ts";
export const dynamic="force-dynamic";
export async function GET(request:Request,ctx:{params:Promise<{caseId:string}>}){const{caseId}=await ctx.params;return adminRead(request,["APPEAL_READ"],async(store)=>{requireManualAppealsEnabled();const record=await store.getAdminManualAppeal(caseId);if(!record)throw new AccountAuthError("MANUAL_APPEAL_NOT_FOUND",404,"申诉不存在。 ");return{record:redactAdminManualAppealEvidence(record)};});}
