import { ADMIN_IDENTITY_SCHEMA_VERSION } from "../../db/admin-identity-schema.ts";
import { ADMIN_OPERATIONS_SCHEMA_VERSION } from "../../db/admin-operations-schema.ts";
import { EXCHANGE_SCHEMA_VERSION } from "../../db/exchange-schema.ts";
import { SUPPLY_SCHEMA_VERSION } from "../../db/supply-schema.ts";
import { STANDARDIZATION_SCHEMA_VERSION } from "../../db/standardization-schema.ts";
import { CARD_HOUR_SCHEMA_VERSION } from "../../db/card-hour-schema.ts";
import { HOSTING_V2_SCHEMA_VERSION } from "../../db/hosting-v2-schema.ts";
import { alipayReadiness } from "./alipay-live.ts";
import { getAccountAuthStore } from "./account-auth-store.ts";
import { getAdminOperationsStore } from "./admin-store.ts";
import { getExchangeStore } from "./exchange-store.ts";
import { getCardHourStore } from "./card-hour-store.ts";
import { evaluateHostingV2Capability } from "./hosting-v2-readiness.ts";
import { getHostingV2Store } from "./hosting-v2-store.ts";
import { readMarketSnapshot } from "./market-snapshot.ts";
import { assertMarketplaceSecurityConfiguration, createMarketplaceReadinessStore } from "./marketplace-store.ts";
import { sshProvisionerReadiness } from "./ssh-provisioner.ts";
import { getSupplyStore } from "./supply-store.ts";
import { getStandardizationStore } from "./standardization-store.ts";

type Environment = Record<string,string|undefined>;
type CheckResult = Readonly<{ready:boolean;schemaVersion:number;probe:"read-only";errorCode?:string}>;

function errorCode(error:unknown){
  const message=error instanceof Error?error.message:"UNKNOWN";
  return /^[A-Z][A-Z0-9_]{2,100}$/u.test(message)?message:"READINESS_CHECK_FAILED";
}

async function storeCheck(schemaVersion:number,probe:()=>Promise<unknown>):Promise<CheckResult>{
  try{await probe();return{ready:true,schemaVersion,probe:"read-only"};}
  catch(error){return{ready:false,schemaVersion,probe:"read-only",errorCode:errorCode(error)};}
}

async function runtimeEnvironment():Promise<Environment>{
  const values:Environment=typeof process==="undefined"?{}:{...process.env};
  try{
    const worker=await import("cloudflare:workers");
    for(const [key,value] of Object.entries(worker.env))if(typeof value==="string")values[key]=value;
  }catch{/* Node deployments do not expose the Workers module. */}
  return values;
}

function requiredCapability(keys:readonly string[],environment:Environment,extraMissing:readonly string[]=[]){
  const missing=[...keys.filter((key)=>!environment[key]?.trim()),...extraMissing];
  return{available:missing.length===0,failClosed:true,missing:[...new Set(missing)]};
}

function capabilityReadiness(environment:Environment){
  const identityExtra:string[]=[];
  if((environment.KAI_ACCOUNT_OIDC_TRANSACTION_SECRET?.trim().length??0)>0&&(environment.KAI_ACCOUNT_OIDC_TRANSACTION_SECRET?.trim().length??0)<32)identityExtra.push("KAI_ACCOUNT_OIDC_TRANSACTION_SECRET(>=32 chars)");
  if(environment.KAI_ACCOUNT_OIDC_CLIENT_ID?.trim()&&!/^kaic_[A-Za-z0-9_-]{8,200}$/u.test(environment.KAI_ACCOUNT_OIDC_CLIENT_ID.trim()))identityExtra.push("KAI_ACCOUNT_OIDC_CLIENT_ID(valid Public Client ID)");
  const alipay=alipayReadiness(environment),ssh=sshProvisionerReadiness(environment);
  return{
    adminPasswordLogin:requiredCapability(["KAI_ADMIN_USERNAME","KAI_ADMIN_PASSWORD_HASH"],environment,
      environment.KAI_ADMIN_PASSWORD_HASH?.startsWith("pbkdf2-sha256:")?[]:["KAI_ADMIN_PASSWORD_HASH(valid PBKDF2 hash)"]),
    kaiIdentityLogin:requiredCapability(["KAI_ACCOUNT_OIDC_CLIENT_ID","KAI_ACCOUNT_OIDC_TRANSACTION_SECRET"],environment,identityExtra),
    alipayLive:{available:alipay.canCreatePayment,enabled:alipay.enabled,configured:alipay.configured,failClosed:true,missing:alipay.missing},
    sshProvisioning:{available:ssh.configured,failClosed:true,missing:ssh.missing},
  };
}

export async function evaluateReadiness(){
  const environment=await runtimeEnvironment();
  const checkedAt=new Date().toISOString();
  const marketplacePromise=(async()=>{
    try{
      await assertMarketplaceSecurityConfiguration();
      const store=await createMarketplaceReadinessStore();
      const health=await store.health().finally(()=>store.close?.());
      return{ready:health.integrity==="ok",...health,probe:"read-only" as const};
    }catch(error){return{ready:false,backend:"unknown" as const,schemaVersion:0,integrity:"error" as const,probe:"read-only" as const,errorCode:errorCode(error)};}
  })();
  const [marketplace,exchange,supply,admin,auth,standardization,cardHours,hostingV2Storage,marketResult]=await Promise.all([
    marketplacePromise,
    storeCheck(EXCHANGE_SCHEMA_VERSION,async()=>{const products=await (await getExchangeStore()).listProductVersions();if(products.length<1)throw new Error("EXCHANGE_REFERENCE_DATA_MISSING");}),
    storeCheck(SUPPLY_SCHEMA_VERSION,async()=>{await (await getSupplyStore()).listOffers("__readiness_probe__");}),
    storeCheck(ADMIN_OPERATIONS_SCHEMA_VERSION,async()=>{await (await getAdminOperationsStore()).listAuditEvents({limit:1});}),
    storeCheck(ADMIN_IDENTITY_SCHEMA_VERSION,async()=>{await (await getAccountAuthStore()).listMemberships("__readiness_probe__");}),
    storeCheck(STANDARDIZATION_SCHEMA_VERSION,async()=>{await (await getStandardizationStore()).getQuotes();}),
    storeCheck(CARD_HOUR_SCHEMA_VERSION,async()=>{await (await getCardHourStore()).health();}),
    (async()=>{
      try{
        const snapshot=await (await getHostingV2Store()).readiness(checkedAt);
        return{ready:true,schemaVersion:HOSTING_V2_SCHEMA_VERSION,probe:"read-only" as const,snapshot};
      }catch(error){return{ready:false,schemaVersion:HOSTING_V2_SCHEMA_VERSION,probe:"read-only" as const,errorCode:errorCode(error),snapshot:null};}
    })(),
    readMarketSnapshot().then((value)=>({ok:true as const,value})).catch((error)=>({ok:false as const,error})),
  ]);
  let market:{source:string;publishedAt:string|null;ageHours:number|null;stale:boolean;ready:boolean;errorCode?:string};
  if(marketResult.ok){
    const publishedAt=new Date(marketResult.value.snapshot.publishedAt),ageHours=Number.isNaN(publishedAt.getTime())?null:(Date.now()-publishedAt.getTime())/3_600_000;
    const stale=ageHours===null||ageHours>26||ageHours< -1;
    market={source:marketResult.value.source,publishedAt:marketResult.value.snapshot.publishedAt,ageHours:ageHours===null?null:Math.round(ageHours*10)/10,stale,ready:marketResult.value.source==="persistent"&&!stale};
  }else market={source:"unavailable",publishedAt:null,ageHours:null,stale:true,ready:false,errorCode:errorCode(marketResult.error)};
  const {snapshot:hostingOperations,...hostingV2Health}=hostingV2Storage;
  const storage={marketplace,exchange,supply,admin,auth,standardization,cardHours,hostingV2:hostingV2Health};
  const capabilities=capabilityReadiness(environment);
  const hostingV2=evaluateHostingV2Capability({
    environment,
    hostingStorage:hostingV2Storage,
    cardHourStorage:cardHours,
    operations:hostingOperations,
    kaiIdentityAvailable:capabilities.kaiIdentityLogin.available,
    alipay:alipayReadiness(environment),
  });
  const ready=market.ready&&Object.values(storage).every((item)=>item.ready)&&hostingV2.ready;
  return{
    ready,
    database:{backend:marketplace.backend,schemaVersion:marketplace.schemaVersion,integrity:marketplace.integrity},
    market,
    storage,
    capabilities,
    hostingV2,
  };
}
