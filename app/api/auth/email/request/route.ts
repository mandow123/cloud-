import { accountAuthErrorResponse, accountAuthJson, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { readAuthJson } from "@/lib/server/account-auth-http";
import { requestEmailOtp } from "@/lib/server/account-auth-otp";
export const dynamic="force-dynamic";
export async function POST(request:Request){try{assertAccountAuthSameOrigin(request);const body=await readAuthJson(request);const email=body&&typeof body==="object"&&!Array.isArray(body)?(body as Record<string,unknown>).email:null;return accountAuthJson(await requestEmailOtp(request,email),202);}catch(error){return accountAuthErrorResponse(error);}}

