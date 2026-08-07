import { accountAuthErrorResponse, accountAuthJson } from "@/lib/server/account-auth";
import { accountSessionEnvelope } from "@/lib/server/account-auth-http";
import { createLocalTestAccountSession } from "@/lib/server/account-auth-local";
export const dynamic="force-dynamic";
export async function POST(request:Request){try{const issued=await createLocalTestAccountSession(request);const headers=new Headers();headers.append("set-cookie",issued.cookie);return accountAuthJson(await accountSessionEnvelope(issued.context),200,headers);}catch(error){return accountAuthErrorResponse(error);}}

