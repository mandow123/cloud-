import { accountAuthErrorResponse, accountAuthJson, assertAccountAuthSameOrigin, logoutAccountSession } from "@/lib/server/account-auth";
export const dynamic="force-dynamic";
export async function POST(request:Request){try{assertAccountAuthSameOrigin(request);const cookie=await logoutAccountSession(request);const headers=new Headers();headers.append("set-cookie",cookie);return accountAuthJson({authenticated:false},200,headers);}catch(error){return accountAuthErrorResponse(error);}}

