import { createAccountSession } from "./account-auth.ts";
import { assertLocalInteractiveRequest, localRoles } from "./account-auth-otp.ts";
import { getAccountAuthStore, type AccountAuthStore } from "./account-auth-store.ts";

type Env=Record<string,string|undefined>;
function localOrganization(env:Env){
  const key=env.KAI_ADMIN_LOCAL_ORGANIZATION_KEY?.trim()||"LOCAL:KAI";
  const name=env.KAI_ADMIN_LOCAL_ORGANIZATION_NAME?.trim()||"KAI Local Development";
  if(!/^LOCAL:[A-Z0-9:_-]{3,80}$/u.test(key)||name.length<2||name.length>80)throw new Error("LOCAL_ORGANIZATION_CONFIG_INVALID");
  return {key,name};
}
export async function createLocalTestAccountSession(request:Request,options:{store?:AccountAuthStore;env?:Env;now?:Date}={}){
  const env=options.env??(typeof process === "undefined" ? {} : process.env);assertLocalInteractiveRequest(request,env);const store=options.store??await getAccountAuthStore(),now=options.now??new Date();
  const subject=env.KAI_ADMIN_LOCAL_SUBJECT?.trim()||"local-root";
  const organization=localOrganization(env);
  const identity=await store.resolveOrCreateIdentity({provider:"LOCAL",tenantKey:organization.key,subject,displayName:env.KAI_ADMIN_LOCAL_DISPLAY_NAME?.trim()||"KAI Local Root",normalizedEmail:null,organizationExternalKey:organization.key,organizationName:organization.name,verifiedAt:now.toISOString()});
  await store.activateMembership(identity.membership.id,localRoles(env),now.toISOString());
  const active=await store.resolveOrCreateIdentity({provider:"LOCAL",tenantKey:organization.key,subject,displayName:identity.account.displayName,normalizedEmail:null,organizationExternalKey:organization.key,organizationName:organization.name,verifiedAt:now.toISOString()});
  return createAccountSession(request,active,"LOCAL_TEST",{store,now});
}
