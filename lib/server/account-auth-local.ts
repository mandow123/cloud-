import { createAccountSession } from "./account-auth.ts";
import { assertLocalInteractiveRequest, localRoles } from "./account-auth-otp.ts";
import { getAccountAuthStore, type AccountAuthStore } from "./account-auth-store.ts";

type Env=Record<string,string|undefined>;
function localIdentity(request:Request,env:Env){
  const host=new URL(request.url).hostname;
  if(env.NODE_ENV!=="production"&&env.KAI_ADMIN_LOCAL_MULTI_ROLE_QA==="1"){
    const profiles:Record<string,{subject:string;displayName:string;organizationKey:string;organizationName:string;roles:string}>={
      "buyer.localhost":{subject:"local-buyer",displayName:"本地买家",organizationKey:"LOCAL:BUYER",organizationName:"本地买家",roles:"SUPPORT_READONLY"},
      "supplier.localhost":{subject:"local-supplier",displayName:"本地供应商",organizationKey:"LOCAL:SUPPLIER",organizationName:"本地供应商",roles:"SUPPORT_READONLY"},
      "root.localhost":{subject:"local-root",displayName:"本地 Root",organizationKey:"LOCAL:ROOT",organizationName:"本地平台管理",roles:"ROOT"},
      "finance.localhost":{subject:"local-finance-approver",displayName:"本地独立财务审批",organizationKey:"LOCAL:FINANCE",organizationName:"本地财务复核",roles:"FINANCE_APPROVER"},
    };
    if(profiles[host])return profiles[host];
  }
  return{
    subject:env.KAI_ADMIN_LOCAL_SUBJECT?.trim()||"local-root",
    displayName:env.KAI_ADMIN_LOCAL_DISPLAY_NAME?.trim()||"KAI Local Root",
    organizationKey:env.KAI_ADMIN_LOCAL_ORGANIZATION_KEY?.trim()||"LOCAL:KAI",
    organizationName:env.KAI_ADMIN_LOCAL_ORGANIZATION_NAME?.trim()||"KAI Local Development",
    roles:env.KAI_ADMIN_LOCAL_ROLES??"SUPPORT_READONLY",
  };
}
function localOrganization(identity:ReturnType<typeof localIdentity>){
  const key=identity.organizationKey;
  const name=identity.organizationName;
  if(!/^LOCAL:[A-Z0-9:_-]{3,80}$/u.test(key)||name.length<2||name.length>80)throw new Error("LOCAL_ORGANIZATION_CONFIG_INVALID");
  return {key,name};
}
export async function createLocalTestAccountSession(request:Request,options:{store?:AccountAuthStore;env?:Env;now?:Date}={}){
  const env=options.env??(typeof process === "undefined" ? {} : process.env);assertLocalInteractiveRequest(request,env);const store=options.store??await getAccountAuthStore(),now=options.now??new Date();
  const configured=localIdentity(request,env);
  const rootAlias=new URL(request.url).hostname==="root.localhost"&&configured.roles.split(",").map((role)=>role.trim()).includes("ROOT");
  if(rootAlias){
    const username=env.KAI_ADMIN_USERNAME?.trim();
    if(!username)throw new Error("LOCAL_ROOT_ALIAS_NOT_CONFIGURED");
    const identity=await store.resolveOrCreatePasswordAdministrator({username,displayName:env.KAI_ADMIN_DISPLAY_NAME?.trim()||"KAI Root",createdAt:now.toISOString()});
    await store.activateMembership(identity.membership.id,["ROOT"],now.toISOString());
    const active=await store.resolveOrCreatePasswordAdministrator({username,displayName:identity.account.displayName,createdAt:now.toISOString()});
    return createAccountSession(request,active,"ADMIN_PASSWORD",{store,now});
  }
  const subject=configured.subject;
  const organization=localOrganization(configured);
  const identity=await store.resolveOrCreateIdentity({provider:"LOCAL",tenantKey:organization.key,subject,displayName:configured.displayName,normalizedEmail:null,organizationExternalKey:organization.key,organizationName:organization.name,verifiedAt:now.toISOString()});
  const roles=localRoles({...env,KAI_ADMIN_LOCAL_ROLES:configured.roles});
  await store.activateMembership(identity.membership.id,roles,now.toISOString());
  const active=await store.resolveOrCreateIdentity({provider:"LOCAL",tenantKey:organization.key,subject,displayName:identity.account.displayName,normalizedEmail:null,organizationExternalKey:organization.key,organizationName:organization.name,verifiedAt:now.toISOString()});
  // The localhost-only preview must exercise the same administrator API guard as
  // the password login. Ordinary supplier and buyer fixtures remain LOCAL_TEST.
  const authMethod=roles.some((role)=>role==="ROOT"||role==="FINANCE_APPROVER")?"ADMIN_PASSWORD":"LOCAL_TEST";
  return createAccountSession(request,active,authMethod,{store,now});
}
