import assert from "node:assert/strict";
import test from "node:test";

import { AccountAuthError } from "../lib/server/account-auth.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { assertLocalSecret, readLocalOtp, requestEmailOtp, verifyEmailOtp } from "../lib/server/account-auth-otp.ts";
import { completeLarkAuthorization, createLarkAuthorization } from "../lib/server/admin-auth-lark.ts";

const localEnv={NODE_ENV:"development",KAI_ADMIN_LOCAL_AUTH:"1",KAI_ADMIN_LOCAL_SECRET:"local-secret-000000000000000000000000000000",KAI_EMAIL_OTP_HMAC_SECRET:"otp-secret-000000000000000000000000000000"};

test("email OTP is one-time, stored as a digest and does not grant admin membership",async()=>{
  const store=await createSqliteAccountAuthStore(":memory:");const now=new Date("2026-08-07T00:00:00Z");
  const request=new Request("http://localhost/api/auth/email/request",{method:"POST",headers:{"user-agent":"test"}});
  const requested=await requestEmailOtp(request,"Outside@Example.com",{store,env:localEnv,now});
  assert.equal(requested.delivery,"LOCAL_INBOX");
  const code=readLocalOtp(requested.challengeId,localEnv);assert.match(code,/^\d{6}$/u);
  const issued=await verifyEmailOtp(new Request("http://localhost/api/auth/email/verify"),{challengeId:requested.challengeId,email:"outside@example.com",code},{store,env:localEnv,now:new Date(now.getTime()+1_000)});
  assert.equal(issued.context.membership.status,"PENDING");assert.deepEqual(issued.context.membership.roles,[]);
  assert.throws(()=>readLocalOtp(requested.challengeId,localEnv),(error)=>error instanceof AccountAuthError&&error.status===401);
  await assert.rejects(verifyEmailOtp(new Request("http://localhost/api/auth/email/verify"),{challengeId:requested.challengeId,email:"outside@example.com",code},{store,env:localEnv,now:new Date(now.getTime()+2_000)}),(error)=>error instanceof AccountAuthError&&error.status===401);
});

test("LOCAL OTP inbox requires a strong server-side secret",async()=>{
  const challengeId="otp_00000000-0000-4000-8000-000000000000";
  await assert.rejects(Promise.resolve().then(()=>assertLocalSecret(new Request(`http://localhost/api/auth/email/local-inbox?challengeId=${challengeId}`),localEnv)),(error)=>error instanceof AccountAuthError&&error.status===403);
  assert.doesNotThrow(()=>assertLocalSecret(new Request(`http://localhost/api/auth/email/local-inbox?challengeId=${challengeId}`,{headers:{"x-kai-local-auth-secret":localEnv.KAI_ADMIN_LOCAL_SECRET}}),localEnv));
});

test("Lark OAuth uses state and S256 PKCE and maps tenant_key plus open_id",async()=>{
  const store=await createSqliteAccountAuthStore(":memory:");const now=new Date("2026-08-07T00:00:00Z");
  const env={NODE_ENV:"test",KAI_LARK_APP_ID:"cli_test",KAI_LARK_APP_SECRET:"secret",KAI_LARK_REDIRECT_URI:"http://localhost/api/auth/lark/callback",KAI_LARK_ALLOWED_TENANT_KEYS:"tenant_a"};
  const started=await createLarkAuthorization(new Request("http://localhost/api/auth/lark/start?returnTo=/admin/orders"),{store,env,now});
  const authorize=new URL(started.authorizationUrl);assert.equal(authorize.searchParams.get("code_challenge_method"),"S256");assert.ok(authorize.searchParams.get("code_challenge"));
  const state=authorize.searchParams.get("state");assert.ok(state);const cookie=started.cookie.split(";")[0];let calls=0;
  const fetcher=async()=>{calls+=1;return calls===1?new Response(JSON.stringify({access_token:"user-token"}),{status:200}):new Response(JSON.stringify({code:0,data:{tenant_key:"tenant_a",open_id:"ou_test",name:"Tester"}}),{status:200});};
  const result=await completeLarkAuthorization(new Request(`http://localhost/api/auth/lark/callback?code=code_1&state=${state}`,{headers:{cookie}}),{store,env,now:new Date(now.getTime()+1_000),fetcher});
  assert.equal(result.context.activeOrganization.externalKey,"LARK:tenant_a");assert.equal(result.context.membership.status,"PENDING");assert.equal(result.returnPath,"/admin/orders");
  await assert.rejects(completeLarkAuthorization(new Request(`http://localhost/api/auth/lark/callback?code=code_1&state=${state}`,{headers:{cookie}}),{store,env,now:new Date(now.getTime()+2_000),fetcher}),(error)=>error instanceof AccountAuthError&&error.status===401);
});

test("production Lark login fails closed without tenant allowlist",async()=>{
  const store=await createSqliteAccountAuthStore(":memory:");
  await assert.rejects(createLarkAuthorization(new Request("https://cloud.kai.com/api/auth/lark/start"),{store,env:{NODE_ENV:"production",KAI_LARK_APP_ID:"cli",KAI_LARK_APP_SECRET:"secret",KAI_LARK_REDIRECT_URI:"https://cloud.kai.com/api/auth/lark/callback"}}),(error)=>error instanceof AccountAuthError&&error.status===503);
});
