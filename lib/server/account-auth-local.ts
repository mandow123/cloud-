import { createAccountSession } from "./account-auth.ts";
import { assertLocalInteractiveRequest, localRoles } from "./account-auth-otp.ts";
import { getAccountAuthStore, type AccountAuthStore } from "./account-auth-store.ts";

type Env=Record<string,string|undefined>;
export async function createLocalTestAccountSession(request:Request,options:{store?:AccountAuthStore;env?:Env;now?:Date}={}){
  const env=options.env??(typeof process === "undefined" ? {} : process.env);assertLocalInteractiveRequest(request,env);const store=options.store??await getAccountAuthStore(),now=options.now??new Date();
  const subject=env.KAI_ADMIN_LOCAL_SUBJECT?.trim()||"local-root";
  const identity=await store.resolveOrCreateIdentity({provider:"LOCAL",tenantKey:"LOCAL",subject,displayName:env.KAI_ADMIN_LOCAL_DISPLAY_NAME?.trim()||"KAI Local Root",normalizedEmail:null,organizationExternalKey:"LOCAL:KAI",organizationName:"KAI Local Development",verifiedAt:now.toISOString()});
  await store.activateMembership(identity.membership.id,localRoles(env),now.toISOString());
  const active=await store.resolveOrCreateIdentity({provider:"LOCAL",tenantKey:"LOCAL",subject,displayName:identity.account.displayName,normalizedEmail:null,organizationExternalKey:"LOCAL:KAI",organizationName:"KAI Local Development",verifiedAt:now.toISOString()});
  return createAccountSession(request,active,"LOCAL_TEST",{store,now});
}
