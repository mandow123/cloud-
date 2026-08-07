import { accountAuthErrorResponse, accountAuthJson, resolveAccountSession } from "@/lib/server/account-auth";
import { accountSessionEnvelope } from "@/lib/server/account-auth-http";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{const context=await resolveAccountSession(request);return accountAuthJson(context?await accountSessionEnvelope(context):{authenticated:false});}catch(error){return accountAuthErrorResponse(error);}}

