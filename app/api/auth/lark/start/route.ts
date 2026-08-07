import { accountAuthErrorResponse } from "@/lib/server/account-auth";
import { createLarkAuthorization } from "@/lib/server/admin-auth-lark";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{const result=await createLarkAuthorization(request);return new Response(null,{status:302,headers:{location:result.authorizationUrl,"set-cookie":result.cookie,"cache-control":"no-store"}});}catch(error){return accountAuthErrorResponse(error);}}

