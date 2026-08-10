import assert from "node:assert/strict";
import test from "node:test";

import { AccountAuthError } from "../lib/server/account-auth.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { assertLocalSecret, readLocalOtp, requestEmailOtp, verifyEmailOtp } from "../lib/server/account-auth-otp.ts";

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
