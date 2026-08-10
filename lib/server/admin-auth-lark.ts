import { AccountAuthError, accountAuthDigest, createAccountSession } from "./account-auth.ts";
import { getAccountAuthStore, type AccountAuthStore } from "./account-auth-store.ts";

type Env = Record<string, string | undefined>;
type Fetcher = typeof fetch;
const SECURE_COOKIE = "__Host-kai_lark_oauth"; const DEV_COOKIE = "kai_lark_oauth_dev";

function runtimeEnv(): Env { return typeof process === "undefined" ? {} : process.env; }
function secure(request: Request) { return new URL(request.url).protocol === "https:" || (typeof process !== "undefined" && process.env.KAI_TRUST_PROXY === "1" && request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https"); }
function randomHex(length: number) { const bytes = new Uint8Array(length); crypto.getRandomValues(bytes); return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function base64url(bytes: Uint8Array) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, ""); }
async function challenge(verifier: string) { return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))); }
function cookieValue(request: Request, name: string) { for (const item of request.headers.get("cookie")?.split(";") ?? []) { const i=item.indexOf("="); if(i>=0&&item.slice(0,i).trim()===name) return decodeURIComponent(item.slice(i+1).trim()); } return null; }
function oauthCookie(request: Request, value: string, maxAge = 600) { return [`${secure(request)?SECURE_COOKIE:DEV_COOKIE}=${encodeURIComponent(value)}`,"Path=/api/auth/lark/callback",`Max-Age=${maxAge}`,"HttpOnly","SameSite=Lax",secure(request)?"Secure":null].filter(Boolean).join("; "); }
function config(env: Env) {
  const appId=env.KAI_LARK_APP_ID?.trim(), secret=env.KAI_LARK_APP_SECRET?.trim(), redirectUri=env.KAI_LARK_REDIRECT_URI?.trim();
  if(!appId||!secret||!redirectUri) throw new AccountAuthError("LARK_OAUTH_NOT_CONFIGURED",503,"飞书登录尚未配置。 ");
  let redirect: URL; try{redirect=new URL(redirectUri);}catch{throw new AccountAuthError("LARK_OAUTH_NOT_CONFIGURED",503,"飞书回调地址无效。 ");}
  if(env.NODE_ENV==="production"&&redirect.protocol!=="https:") throw new AccountAuthError("LARK_OAUTH_NOT_CONFIGURED",503,"飞书回调必须使用 HTTPS。 ");
  const allowedTenants=(env.KAI_LARK_ALLOWED_TENANT_KEYS??"").split(",").map((item)=>item.trim()).filter(Boolean);
  if(env.NODE_ENV==="production"&&!allowedTenants.length) throw new AccountAuthError("LARK_OAUTH_NOT_CONFIGURED",503,"飞书租户白名单未配置。 ");
  return {appId,secret,redirectUri,allowedTenants};
}
function returnPath(value: string|null){return value&&value.startsWith("/")&&!value.startsWith("//")&&value.length<=300?value:"/admin";}

export function adminLarkReturnPath(
  requestedPath: string,
  membership: Readonly<{ status: string; roles: readonly string[] }>,
) {
  const targetsAdmin = requestedPath === "/admin" || requestedPath.startsWith("/admin/");
  if (!targetsAdmin || requestedPath === "/admin/login") return requestedPath;
  return membership.status === "ACTIVE" && membership.roles.includes("ROOT")
    ? requestedPath
    : "/admin/login";
}

export async function createLarkAuthorization(request: Request, options:{store?:AccountAuthStore;env?:Env;now?:Date}={}){
  const env=options.env??runtimeEnv(), cfg=config(env), store=options.store??await getAccountAuthStore(), now=options.now??new Date();
  const state=randomHex(32), verifier=randomHex(48), expiresAt=new Date(now.getTime()+10*60_000).toISOString();
  await store.createOAuthTransaction({stateHash:await accountAuthDigest(state),returnPath:returnPath(new URL(request.url).searchParams.get("returnTo")),createdAt:now.toISOString(),expiresAt});
  const url=new URL("https://accounts.feishu.cn/open-apis/authen/v1/authorize");
  url.searchParams.set("client_id",cfg.appId);url.searchParams.set("response_type","code");url.searchParams.set("redirect_uri",cfg.redirectUri);url.searchParams.set("state",state);url.searchParams.set("code_challenge",await challenge(verifier));url.searchParams.set("code_challenge_method","S256");
  return {authorizationUrl:url.toString(),cookie:oauthCookie(request,`${state}.${verifier}`),expiresAt};
}

export async function completeLarkAuthorization(request:Request,options:{store?:AccountAuthStore;env?:Env;now?:Date;fetcher?:Fetcher}={}){
  const env=options.env??runtimeEnv(),cfg=config(env),store=options.store??await getAccountAuthStore(),now=options.now??new Date(),query=new URL(request.url).searchParams;
  const code=query.get("code"),state=query.get("state"),stored=cookieValue(request,secure(request)?SECURE_COOKIE:DEV_COOKIE);
  if(!code||!state||!stored) throw new AccountAuthError("LARK_OAUTH_INVALID",401,"飞书登录状态无效。 ");
  const [cookieState,verifier]=stored.split(".");
  if(cookieState!==state||!verifier||!/^[a-f0-9]{96}$/u.test(verifier)) throw new AccountAuthError("LARK_OAUTH_INVALID",401,"飞书登录状态无效。 ");
  const transaction=await store.consumeOAuthTransaction(await accountAuthDigest(state),now.toISOString());if(!transaction) throw new AccountAuthError("LARK_OAUTH_INVALID",401,"飞书登录状态已过期或已使用。 ");
  const fetcher=options.fetcher??fetch;
  const tokenResponse=await fetcher("https://open.feishu.cn/open-apis/authen/v2/oauth/token",{method:"POST",headers:{"content-type":"application/json; charset=utf-8"},body:JSON.stringify({grant_type:"authorization_code",client_id:cfg.appId,client_secret:cfg.secret,code,redirect_uri:cfg.redirectUri,code_verifier:verifier})});
  if(!tokenResponse.ok) throw new AccountAuthError("LARK_OAUTH_FAILED",401,"飞书授权码兑换失败。 ");
  const tokenJson=await tokenResponse.json() as Record<string,unknown>;const tokenData=(tokenJson.data&&typeof tokenJson.data==="object"?tokenJson.data:tokenJson) as Record<string,unknown>;const accessToken=tokenData.access_token;
  if(typeof accessToken!=="string"||!accessToken) throw new AccountAuthError("LARK_OAUTH_FAILED",401,"飞书未返回用户访问凭据。 ");
  const userResponse=await fetcher("https://open.feishu.cn/open-apis/authen/v1/user_info",{headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json; charset=utf-8"}});
  if(!userResponse.ok) throw new AccountAuthError("LARK_OAUTH_FAILED",401,"飞书用户信息读取失败。 ");
  const userJson=await userResponse.json() as Record<string,unknown>;const data=(userJson.data&&typeof userJson.data==="object"?userJson.data:null) as Record<string,unknown>|null;
  const tenantKey=data?.tenant_key,openId=data?.open_id,name=data?.name;
  if(typeof tenantKey!=="string"||typeof openId!=="string"||typeof name!=="string"||!tenantKey||!openId||!name) throw new AccountAuthError("LARK_OAUTH_FAILED",401,"飞书身份信息不完整。 ");
  if(cfg.allowedTenants.length&&!cfg.allowedTenants.includes(tenantKey)) throw new AccountAuthError("LARK_TENANT_FORBIDDEN",403,"该飞书租户未获准访问。 ");
  const identity=await store.resolveOrCreateIdentity({provider:"LARK",tenantKey,subject:openId,displayName:name,normalizedEmail:null,organizationExternalKey:`LARK:${tenantKey}`,organizationName:`Lark tenant ${tenantKey.slice(0,8)}`,verifiedAt:now.toISOString()});
  const issued=await createAccountSession(request,identity,"LARK_OAUTH",{store,now});
  return {...issued,returnPath:adminLarkReturnPath(transaction.returnPath,issued.context.membership),clearOAuthCookie:oauthCookie(request,"",0)};
}
