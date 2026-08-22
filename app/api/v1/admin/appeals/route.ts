import { redactAdminManualAppealEvidence, requireManualAppealsEnabled } from "@/lib/server/manual-appeals";
import { adminRead } from "../_shared.ts";
export const dynamic="force-dynamic";
export async function GET(request:Request){return adminRead(request,["APPEAL_READ"],async(store)=>{requireManualAppealsEnabled();const records=(await store.listAdminManualAppeals(100)).map(redactAdminManualAppealEvidence);return{records,count:records.length};});}
