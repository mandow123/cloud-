import { AccountAuthError, createAccountSession } from "./account-auth.ts";
import { getAccountAuthStore, type AccountAuthStore } from "./account-auth-store.ts";
import type { AdminRole } from "../admin-auth-types.ts";

type Env=Record<string,string|undefined>;

function localRoles(env:Env):AdminRole[]{
  const allowed=new Set<AdminRole>(["ROOT","ROLE_ADMIN","INTAKE_OPERATOR","INVENTORY_OPERATOR","VERIFICATION_REVIEWER","MARKET_OPERATOR","FULFILLMENT_OPERATOR","FINANCE_OPERATOR","FINANCE_APPROVER","SUPPORT_READONLY","AUDITOR"]);
  const roles=(env.KAI_ADMIN_LOCAL_ROLES??"ROOT").split(",").map((value)=>value.trim()).filter((value):value is AdminRole=>allowed.has(value as AdminRole));
  return roles.length>0?roles:["ROOT"];
}

function assertLocalInteractiveRequest(request:Request,env:Env){
  const url=new URL(request.url);
  if(env.NODE_ENV==="production"||env.KAI_ADMIN_LOCAL_AUTH!=="1"||!new Set(["localhost","127.0.0.1","::1"]).has(url.hostname)){
    throw new AccountAuthError("LOCAL_AUTH_DISABLED",403,"本地认证仅允许开发环境回环请求。 ");
  }
}

export async function createLocalTestAccountSession(request:Request,options:{store?:AccountAuthStore;env?:Env;now?:Date}={}){
  const env=options.env??(typeof process === "undefined" ? {} : process.env);assertLocalInteractiveRequest(request,env);const store=options.store??await getAccountAuthStore(),now=options.now??new Date();
  const subject=env.KAI_ADMIN_LOCAL_SUBJECT?.trim()||"local-root";
  const identity=await store.resolveOrCreateIdentity({provider:"LOCAL",tenantKey:"LOCAL",subject,displayName:env.KAI_ADMIN_LOCAL_DISPLAY_NAME?.trim()||"KAI Local Root",normalizedEmail:null,organizationExternalKey:"LOCAL:KAI",organizationName:"KAI Local Development",verifiedAt:now.toISOString()});
  await store.activateMembership(identity.membership.id,localRoles(env),now.toISOString());
  const active=await store.resolveOrCreateIdentity({provider:"LOCAL",tenantKey:"LOCAL",subject,displayName:identity.account.displayName,normalizedEmail:null,organizationExternalKey:"LOCAL:KAI",organizationName:"KAI Local Development",verifiedAt:now.toISOString()});
  return createAccountSession(request,active,"LOCAL_TEST",{store,now});
}
