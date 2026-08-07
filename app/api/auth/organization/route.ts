import { AccountAuthError, accountAuthErrorResponse, accountAuthJson, assertAccountAuthSameOrigin, switchAccountOrganization } from "@/lib/server/account-auth";
import { accountSessionEnvelope, readAuthJson } from "@/lib/server/account-auth-http";
export const dynamic="force-dynamic";
export async function POST(request:Request){try{assertAccountAuthSameOrigin(request);const body=await readAuthJson(request);const organizationId=body&&typeof body==="object"&&!Array.isArray(body)?(body as Record<string,unknown>).organizationId:null;if(typeof organizationId!=="string"||!/^org_[a-f0-9]{40}$/u.test(organizationId))throw new AccountAuthError("ORGANIZATION_INVALID",400,"组织标识无效。 ");const issued=await switchAccountOrganization(request,organizationId);const headers=new Headers();headers.append("set-cookie",issued.cookie);return accountAuthJson(await accountSessionEnvelope(issued.context),200,headers);}catch(error){return accountAuthErrorResponse(error);}}

