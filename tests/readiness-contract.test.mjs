import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("liveness remains a lightweight process-only check",()=>{
  const live=source("app/api/live/route.ts");
  assert.doesNotMatch(live,/readiness|getMarketplaceStore|getExchangeStore|getSupplyStore|getAdminOperationsStore|getAccountAuthStore/);
  assert.match(live,/status:\s*"ok"/);assert.match(live,/check:\s*"live"/);
});

test("readiness probes every storage domain without creating identities or granting roles",()=>{
  const route=source("app/api/ready/route.ts"),readiness=source("lib/server/readiness.ts");
  assert.match(route,/evaluateReadiness/);
  assert.match(route,/isLocalHostingAcceptance\(\)/);
  for(const dependency of ["createMarketplaceReadinessStore","getExchangeStore","getSupplyStore","getAdminOperationsStore","getAccountAuthStore","getStandardizationStore","getCardHourStore","getHostingV2Store","evaluateHostingV2Capability","probeKaiIdentityDiscovery"])assert.match(readiness,new RegExp(dependency));
  assert.doesNotMatch(readiness,/resolveOrCreateIdentity|activateMembership|invitePrincipal|createOffer|createResource|createCheckout/);
  assert.match(readiness,/failClosed:true/);
  assert.match(readiness,/qixiangPayCardHourTopup:\{[\s\S]*available:qixiangPay\.canCreatePayment,[\s\S]*reconciliationAvailable:qixiangPay\.canReconcilePayment,[\s\S]*reconciliationEnabled:qixiangPay\.reconciliationEnabled,[\s\S]*failClosed:true,[\s\S]*\}/u);
  assert.match(readiness,/capabilities\.qixiangPayCardHourTopup=\{[\s\S]*available:qixiangPay\.canCreatePayment&&capabilities\.kaiIdentityLogin\.available&&kaiIdentityLoginAudited/u);
  assert.match(readiness,/const paymentGateReady=\(!qixiangPay\.enabled\|\|qixiangPay\.canCreatePayment\)[\s\S]*&&\(!qixiangPay\.reconciliationEnabled\|\|qixiangPay\.canReconcilePayment\)/u);
  assert.doesNotMatch(readiness,/qixiangPayCardHourTopup:\{[^\n]*(?:missing|channels|merchantAccountRef)/u);
  assert.match(readiness,/const hostingV2StoragePromise=\(async\(\)=>/);
  assert.doesNotMatch(readiness,/isHostingV2ConfigurationEnabled\(environment\)/);
  assert.match(readiness,/probe:"deferred"/);
});
