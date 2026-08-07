import { accountAuthErrorResponse } from "@/lib/server/account-auth";
import { completeLarkAuthorization } from "@/lib/server/admin-auth-lark";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{const result=await completeLarkAuthorization(request);const headers=new Headers({location:new URL(result.returnPath,new URL(request.url).origin).toString(),"cache-control":"no-store"});headers.append("set-cookie",result.cookie);headers.append("set-cookie",result.clearOAuthCookie);return new Response(null,{status:302,headers});}catch(error){return accountAuthErrorResponse(error);}}

