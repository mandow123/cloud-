import { AccountAuthError, accountAuthErrorResponse, accountAuthJson, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { accountSessionEnvelope, readAuthJson } from "@/lib/server/account-auth-http";
import { verifyEmailOtp } from "@/lib/server/account-auth-otp";
export const dynamic="force-dynamic";
export async function POST(request:Request){try{assertAccountAuthSameOrigin(request);const body=await readAuthJson(request);if(!body||typeof body!=="object"||Array.isArray(body))throw new AccountAuthError("AUTH_JSON_INVALID",400,"请求正文不是有效的认证数据。");const input=body as Record<string,unknown>;const issued=await verifyEmailOtp(request,{challengeId:input.challengeId,email:input.email,code:input.code});const headers=new Headers();headers.append("set-cookie",issued.cookie);return accountAuthJson(await accountSessionEnvelope(issued.context),200,headers);}catch(error){return accountAuthErrorResponse(error);}}
