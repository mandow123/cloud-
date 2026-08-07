import { accountAuthErrorResponse, accountAuthJson } from "@/lib/server/account-auth";
import { assertLocalSecret, readLocalOtp } from "@/lib/server/account-auth-otp";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{assertLocalSecret(request);const challengeId=new URL(request.url).searchParams.get("challengeId")??"";return accountAuthJson({challengeId,code:readLocalOtp(challengeId)});}catch(error){return accountAuthErrorResponse(error);}}

